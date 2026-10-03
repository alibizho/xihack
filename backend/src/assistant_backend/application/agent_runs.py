import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy import and_, delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from assistant_backend.application.agent_dto import RunAccepted, RunEventView, RunStatus
from assistant_backend.config import Settings
from assistant_backend.domain.conversations import title_from_first_message
from assistant_backend.infrastructure.models import (
    AgentRun,
    AuthRateLimit,
    Conversation,
    Message,
    Proposal,
    RunEvent,
    User,
)


class RunFailure(Exception):
    def __init__(self, code: str, status: int, message: str) -> None:
        self.code = code
        self.status = status
        self.message = message


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _fingerprint(conversation_id: str, content: str) -> str:
    canonical = json.dumps([conversation_id, content], ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


def _view(run: AgentRun, replayed: bool = False) -> RunAccepted:
    return RunAccepted(
        run_id=run.run_id,
        status=run.status,
        created_at=run.created_at,
        replayed=replayed,
    )


class AgentRunService:
    def __init__(self, factory: sessionmaker[Session], settings: Settings) -> None:
        self.factory = factory
        self.settings = settings

    def submit_message(
        self,
        user_id: str,
        ip_address: str,
        conversation_id: str,
        client_message_id: str,
        content: str,
    ) -> RunAccepted:
        fingerprint = _fingerprint(conversation_id, content)
        now = _utcnow()
        try:
            with self.factory.begin() as session:
                existing = session.scalar(
                    select(AgentRun).where(
                        AgentRun.user_id == user_id,
                        AgentRun.client_message_id == client_message_id,
                    )
                )
                if existing:
                    if existing.request_fingerprint != fingerprint:
                        raise RunFailure("IDEMPOTENCY_CONFLICT", 409, "Message request key reused")
                    return _view(existing, replayed=True)

                user = session.scalar(select(User).where(User.user_id == user_id).with_for_update())
                if user is None:
                    raise RunFailure("NOT_FOUND", 404, "User not found")
                conversation = session.scalar(
                    select(Conversation)
                    .where(
                        Conversation.user_id == user_id,
                        Conversation.conversation_id == conversation_id,
                    )
                    .with_for_update()
                )
                if conversation is None:
                    raise RunFailure("NOT_FOUND", 404, "Conversation not found")

                active_count = session.scalar(
                    select(func.count())
                    .select_from(AgentRun)
                    .where(
                        AgentRun.user_id == user_id,
                        AgentRun.status.in_(("queued", "running")),
                    )
                )
                if (active_count or 0) >= self.settings.agent_user_concurrent_limit:
                    raise RunFailure("RUN_LIMIT_REACHED", 429, "Too many active runs")

                self._consume_rate_limits(session, user_id, ip_address, now)
                if (
                    conversation.title == "新对话"
                    and session.scalar(
                        select(Message.message_id)
                        .where(Message.conversation_id == conversation_id)
                        .limit(1)
                    )
                    is None
                ):
                    conversation.title = title_from_first_message(content)
                message = Message(
                    message_id=str(uuid4()),
                    conversation_id=conversation_id,
                    role="user",
                    content=content,
                    created_at=now,
                )
                run = AgentRun(
                    run_id=str(uuid4()),
                    user_id=user_id,
                    conversation_id=conversation_id,
                    user_message_id=message.message_id,
                    client_message_id=client_message_id,
                    request_fingerprint=fingerprint,
                    status="queued",
                    phase="queued",
                    attempt_count=0,
                    worker_id=None,
                    lease_expires_at=None,
                    last_event_sequence=1,
                    input_tokens=0,
                    output_tokens=0,
                    error_code=None,
                    created_at=now,
                    updated_at=now,
                )
                conversation.updated_at = now
                session.add(message)
                session.flush()
                session.add(run)
                session.flush()
                session.add(
                    RunEvent(
                        event_id=str(uuid4()),
                        run_id=run.run_id,
                        sequence=1,
                        event_type="run.status",
                        payload={"run_id": run.run_id, "phase": "queued"},
                        created_at=now,
                    )
                )
                session.flush()
                return _view(run)
        except IntegrityError:
            with self.factory() as session:
                existing = session.scalar(
                    select(AgentRun).where(
                        AgentRun.user_id == user_id,
                        AgentRun.client_message_id == client_message_id,
                    )
                )
                if existing and existing.request_fingerprint == fingerprint:
                    return _view(existing, replayed=True)
                if existing:
                    raise RunFailure(
                        "IDEMPOTENCY_CONFLICT", 409, "Message request key reused"
                    ) from None
            raise

    def get(self, user_id: str, run_id: str) -> RunStatus:
        with self.factory() as session:
            run = session.scalar(
                select(AgentRun).where(AgentRun.user_id == user_id, AgentRun.run_id == run_id)
            )
            if run is None:
                raise RunFailure("NOT_FOUND", 404, "Run not found")
            assistant = session.get(Message, run.final_message_id) if run.final_message_id else None
            return RunStatus(
                run_id=run.run_id,
                status=run.status,
                phase=run.phase,
                user_message_id=run.user_message_id,
                assistant_message_id=run.final_message_id,
                assistant_content=assistant.content if assistant else None,
                error_code=run.error_code,
                created_at=run.created_at,
                updated_at=run.updated_at,
                last_event_sequence=run.last_event_sequence,
            )

    def pending_proposal_ids(self, user_id: str, conversation_id: str) -> list[str]:
        with self.factory() as session:
            owned_conversation = session.scalar(
                select(Conversation.conversation_id).where(
                    Conversation.user_id == user_id,
                    Conversation.conversation_id == conversation_id,
                )
            )
            if owned_conversation is None:
                raise RunFailure("NOT_FOUND", 404, "Conversation not found")
            return list(
                session.scalars(
                    select(Proposal.proposal_id)
                    .join(
                        AgentRun,
                        and_(
                            AgentRun.user_id == Proposal.user_id,
                            Proposal.client_request_id.like("agent:" + AgentRun.run_id + ":%"),
                        ),
                    )
                    .where(
                        Proposal.user_id == user_id,
                        Proposal.source == "agent",
                        Proposal.status == "pending",
                        AgentRun.conversation_id == conversation_id,
                    )
                    .order_by(Proposal.created_at.desc(), Proposal.proposal_id.desc())
                )
            )

    def events_after(self, user_id: str, run_id: str, sequence: int) -> list[RunEventView]:
        retained_after = _utcnow() - timedelta(days=self.settings.agent_event_retention_days)
        with self.factory() as session:
            run = session.scalar(
                select(AgentRun).where(AgentRun.user_id == user_id, AgentRun.run_id == run_id)
            )
            if run is None:
                raise RunFailure("NOT_FOUND", 404, "Run not found")
            rows = session.scalars(
                select(RunEvent)
                .where(
                    RunEvent.run_id == run_id,
                    RunEvent.sequence > sequence,
                    RunEvent.created_at >= retained_after,
                )
                .order_by(RunEvent.sequence)
                .limit(500)
            )
            return [
                RunEventView(
                    sequence=row.sequence,
                    event_type=row.event_type,
                    payload=row.payload,
                    created_at=row.created_at,
                )
                for row in rows
            ]

    def status_for_stream(self, user_id: str, run_id: str) -> RunStatus:
        return self.get(user_id, run_id)

    def expired_cursor(self, run_id: str, sequence: int) -> bool:
        retained_after = _utcnow() - timedelta(days=self.settings.agent_event_retention_days)
        with self.factory() as session:
            run = session.get(AgentRun, run_id)
            if run is None or sequence >= run.last_event_sequence:
                return False
            first = session.scalar(
                select(func.min(RunEvent.sequence)).where(
                    RunEvent.run_id == run_id,
                    RunEvent.created_at >= retained_after,
                )
            )
            return first is None or sequence < first - 1

    def prune_events(self) -> int:
        cutoff = _utcnow() - timedelta(days=self.settings.agent_event_retention_days)
        with self.factory.begin() as session:
            result = session.execute(delete(RunEvent).where(RunEvent.created_at < cutoff))
            quota_rows = session.execute(
                delete(AuthRateLimit).where(
                    AuthRateLimit.scope.like("agent_%"), AuthRateLimit.window_start < cutoff
                )
            )
            return int(result.rowcount or 0) + int(quota_rows.rowcount or 0)

    def claim_next(self, worker_id: str) -> str | None:
        now = _utcnow()
        lease = now + timedelta(seconds=self.settings.agent_max_run_seconds + 60)
        with self.factory.begin() as session:
            expired = list(
                session.scalars(
                    select(AgentRun)
                    .where(
                        AgentRun.status == "running",
                        AgentRun.lease_expires_at < now,
                    )
                    .order_by(AgentRun.lease_expires_at)
                    .limit(20)
                    .with_for_update(skip_locked=True)
                )
            )
            for run in expired:
                run.status = "failed"
                run.phase = "failed"
                run.error_code = "WORKER_INTERRUPTED"
                run.worker_id = None
                run.lease_expires_at = None
                run.updated_at = now
                self._record_event(
                    session,
                    run,
                    "run.failed",
                    {"run_id": run.run_id, "code": run.error_code},
                    now,
                )

            run = session.scalar(
                select(AgentRun)
                .where(AgentRun.status == "queued")
                .order_by(AgentRun.created_at, AgentRun.run_id)
                .limit(1)
                .with_for_update(skip_locked=True)
            )
            if run is None:
                return None
            run.status = "running"
            run.phase = "starting"
            run.worker_id = worker_id
            run.lease_expires_at = lease
            run.attempt_count += 1
            run.updated_at = now
            self._record_event(
                session,
                run,
                "run.started",
                {"run_id": run.run_id, "attempt": run.attempt_count},
                now,
            )
            return run.run_id

    def load_messages(self, run_id: str) -> tuple[str, str, list[dict[str, str]]]:
        with self.factory() as session:
            run = session.get(AgentRun, run_id)
            if run is None:
                raise RunFailure("NOT_FOUND", 404, "Run not found")
            rows = list(
                session.scalars(
                    select(Message)
                    .join(Conversation, Conversation.conversation_id == Message.conversation_id)
                    .where(
                        Conversation.user_id == run.user_id,
                        Message.conversation_id == run.conversation_id,
                    )
                    .order_by(Message.created_at.desc(), Message.message_id.desc())
                    .limit(20)
                )
            )
            rows.reverse()
            return (
                run.user_id,
                run.conversation_id,
                [{"role": row.role, "content": row.content} for row in rows],
            )

    def append_event(
        self,
        run_id: str,
        worker_id: str,
        event_type: str,
        payload: dict,
        *,
        phase: str | None = None,
        input_tokens: int = 0,
        output_tokens: int = 0,
    ) -> bool:
        now = _utcnow()
        with self.factory.begin() as session:
            preliminary = session.get(AgentRun, run_id)
            if preliminary is None:
                return False
            conversation = session.scalar(
                select(Conversation)
                .where(
                    Conversation.user_id == preliminary.user_id,
                    Conversation.conversation_id == preliminary.conversation_id,
                )
                .with_for_update()
            )
            if conversation is None:
                return False
            run = session.scalar(
                select(AgentRun)
                .where(
                    AgentRun.run_id == run_id,
                    AgentRun.status == "running",
                    AgentRun.worker_id == worker_id,
                )
                .with_for_update()
            )
            if run is None:
                return False
            self._record_event(session, run, event_type, payload, now)
            run.input_tokens += input_tokens
            run.output_tokens += output_tokens
            if phase is not None:
                run.phase = phase
            run.updated_at = now
            run.lease_expires_at = now + timedelta(seconds=self.settings.agent_max_run_seconds + 60)
            return True

    def complete(
        self,
        run_id: str,
        worker_id: str,
        content: str,
        input_tokens: int,
        output_tokens: int,
    ) -> bool:
        now = _utcnow()
        with self.factory.begin() as session:
            preliminary = session.get(AgentRun, run_id)
            if preliminary is None:
                return False
            conversation = session.scalar(
                select(Conversation)
                .where(
                    Conversation.user_id == preliminary.user_id,
                    Conversation.conversation_id == preliminary.conversation_id,
                )
                .with_for_update()
            )
            if conversation is None:
                return False
            run = session.scalar(
                select(AgentRun)
                .where(
                    AgentRun.run_id == run_id,
                    AgentRun.status == "running",
                    AgentRun.worker_id == worker_id,
                )
                .with_for_update()
            )
            if run is None:
                return False
            assistant = Message(
                message_id=str(uuid4()),
                conversation_id=run.conversation_id,
                role="assistant",
                content=content,
                created_at=now,
            )
            session.add(assistant)
            session.flush()
            run.status = "completed"
            run.phase = "completed"
            run.final_message_id = assistant.message_id
            run.input_tokens += input_tokens
            run.output_tokens += output_tokens
            run.worker_id = None
            run.lease_expires_at = None
            run.updated_at = now
            conversation.updated_at = now
            self._record_event(
                session,
                run,
                "run.completed",
                {"run_id": run_id, "assistant_message_id": assistant.message_id},
                now,
            )
            return True

    def fail(self, run_id: str, worker_id: str, code: str) -> bool:
        now = _utcnow()
        with self.factory.begin() as session:
            preliminary = session.get(AgentRun, run_id)
            if preliminary is None:
                return False
            conversation = session.scalar(
                select(Conversation)
                .where(
                    Conversation.user_id == preliminary.user_id,
                    Conversation.conversation_id == preliminary.conversation_id,
                )
                .with_for_update()
            )
            if conversation is None:
                return False
            run = session.scalar(
                select(AgentRun)
                .where(
                    AgentRun.run_id == run_id,
                    AgentRun.status == "running",
                    AgentRun.worker_id == worker_id,
                )
                .with_for_update()
            )
            if run is None:
                return False
            run.status = "failed"
            run.phase = "failed"
            run.error_code = code
            run.worker_id = None
            run.lease_expires_at = None
            run.updated_at = now
            self._record_event(
                session,
                run,
                "run.failed",
                {"run_id": run_id, "code": code},
                now,
            )
            return True

    @staticmethod
    def _record_event(
        session: Session,
        run: AgentRun,
        event_type: str,
        payload: dict,
        created_at: datetime,
    ) -> None:
        run.last_event_sequence += 1
        session.add(
            RunEvent(
                event_id=str(uuid4()),
                run_id=run.run_id,
                sequence=run.last_event_sequence,
                event_type=event_type,
                payload={**payload, "sequence": run.last_event_sequence},
                created_at=created_at,
            )
        )

    def _consume_rate_limits(
        self, session: Session, user_id: str, ip_address: str, now: datetime
    ) -> None:
        windows = (
            ("agent_user_hour", user_id, 3600, self.settings.agent_user_hour_limit),
            ("agent_ip_hour", ip_address, 3600, self.settings.agent_ip_hour_limit),
            ("agent_global_minute", "global", 60, self.settings.agent_global_minute_limit),
        )
        table = AuthRateLimit.__table__
        for scope, subject, seconds, limit in windows:
            window_start = datetime.fromtimestamp(
                int(now.timestamp()) // seconds * seconds, tz=timezone.utc
            )
            subject_hash = hmac.new(
                self.settings.csrf_secret.encode(),
                f"limit:{scope}:{subject}".encode(),
                hashlib.sha256,
            ).hexdigest()
            statement = insert(table).values(
                scope=scope,
                subject_hash=subject_hash,
                window_start=window_start,
                attempts=1,
            )
            statement = statement.on_conflict_do_update(
                index_elements=[table.c.scope, table.c.subject_hash, table.c.window_start],
                set_={"attempts": table.c.attempts + 1},
            ).returning(table.c.attempts)
            attempts = session.scalar(statement)
            if attempts is not None and attempts > limit:
                raise RunFailure("RATE_LIMITED", 429, "Too many requests; try again later")
