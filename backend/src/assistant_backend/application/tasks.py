from __future__ import annotations

import base64
import hashlib
import json
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from uuid import uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import and_, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from assistant_backend.infrastructure.models import (
    AgentRun,
    Proposal,
    ProposalBatch,
    Task,
    TaskReport,
)
from assistant_backend.presentation.schemas import (
    ConfirmationReceipt,
    DateDue,
    MinuteDue,
    ProposalCreateRequest,
    ProposalBatchConfirmationReceipt,
    ProposalBatchResponse,
    ProposalResponse,
    TaskCreate,
    TaskListResponse,
    TaskPatch,
    TaskResponse,
)


@dataclass
class TaskFailure(Exception):
    code: str
    status: int
    message: str


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _fingerprint(body: ProposalCreateRequest) -> str:
    encoded = body.model_dump_json(exclude_none=True).encode()
    return hashlib.sha256(encoded).hexdigest()


def _task_response(task: Task) -> TaskResponse:
    due = None
    if task.due_precision == "date":
        due = DateDue(precision="date", date=task.due_date, timezone=task.due_timezone)
    elif task.due_precision == "minute":
        due = MinuteDue(
            precision="minute",
            at=task.due_at.astimezone(ZoneInfo(task.due_timezone)),
            timezone=task.due_timezone,
        )
    return TaskResponse(
        task_id=task.task_id,
        title=task.title,
        description=task.description,
        category=task.category,
        due=due,
        importance=task.importance,
        urgency=task.urgency,
        status=task.status,
        version=task.version,
        created_at=task.created_at,
        updated_at=task.updated_at,
    )


def _proposal_response(proposal: Proposal) -> ProposalResponse:
    return ProposalResponse(
        proposal_id=proposal.proposal_id,
        operation=proposal.operation,
        task_id=proposal.task_id,
        expected_version=proposal.expected_version,
        task=TaskCreate.model_validate(proposal.payload)
        if proposal.operation == "create"
        else None,
        changes=TaskPatch.model_validate(proposal.payload)
        if proposal.operation == "update"
        else None,
        status=proposal.status,
        expires_at=proposal.expires_at,
    )


def _batch_response(session: Session, batch: ProposalBatch) -> ProposalBatchResponse:
    proposals = list(
        session.scalars(
            select(Proposal)
            .where(Proposal.user_id == batch.user_id, Proposal.batch_id == batch.batch_id)
            .order_by(Proposal.created_at, Proposal.proposal_id)
        )
    )
    pending = [proposal for proposal in proposals if proposal.status == "pending"]
    status = batch.status
    if status == "pending":
        if not pending:
            status = "cancelled"
        elif _now() >= batch.expires_at:
            status = "expired"
    return ProposalBatchResponse(
        batch_id=batch.batch_id,
        run_id=batch.run_id,
        status=status,
        proposals=[_proposal_response(proposal) for proposal in proposals],
        expires_at=batch.expires_at,
        created_at=batch.created_at,
    )


def _batch_fingerprint(tasks: list[TaskCreate]) -> str:
    encoded = json.dumps(
        [task.model_dump(mode="json") for task in tasks],
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    return hashlib.sha256(encoded).hexdigest()


def _set_due(task: Task, due: DateDue | MinuteDue | None) -> None:
    task.due_precision = due.precision if due else None
    task.due_timezone = due.timezone if due else None
    task.due_date = (
        due.date
        if isinstance(due, DateDue)
        else due.at.astimezone(ZoneInfo(due.timezone)).date()
        if isinstance(due, MinuteDue)
        else None
    )
    task.due_at = due.at if isinstance(due, MinuteDue) else None


class TaskService:
    def __init__(self, factory: sessionmaker[Session]) -> None:
        self.factory = factory

    def get(self, user_id: str, task_id: str) -> TaskResponse:
        with self.factory() as session:
            task = session.scalar(
                select(Task).where(Task.user_id == user_id, Task.task_id == task_id)
            )
            if task is None:
                raise TaskFailure("NOT_FOUND", 404, "Task not found")
            return _task_response(task)

    def list(
        self,
        user_id: str,
        *,
        keyword: str | None = None,
        due_from: date | None = None,
        due_to: date | None = None,
        important: bool | None = None,
        urgent: bool | None = None,
        status: str | None = None,
        category: str | None = None,
        limit: int = 20,
        cursor: str | None = None,
    ) -> TaskListResponse:
        statement = select(Task).where(Task.user_id == user_id)
        if keyword:
            statement = statement.where(Task.title.ilike(f"%{keyword}%"))
        if due_from:
            statement = statement.where(Task.due_date >= due_from)
        if due_to:
            statement = statement.where(Task.due_date <= due_to)
        if important is not None:
            statement = statement.where(Task.importance >= 6 if important else Task.importance < 6)
        if urgent is not None:
            statement = statement.where(Task.urgency >= 6 if urgent else Task.urgency < 6)
        if status:
            statement = statement.where(Task.status == status)
        if category:
            statement = statement.where(Task.category == category)
        if cursor:
            try:
                moment, task_id = json.loads(base64.urlsafe_b64decode(cursor + "=="))
                created = datetime.fromisoformat(moment)
                statement = statement.where(
                    or_(
                        Task.created_at < created,
                        and_(Task.created_at == created, Task.task_id < task_id),
                    )
                )
            except (ValueError, TypeError, UnicodeDecodeError) as exc:
                raise TaskFailure("INVALID_REQUEST", 422, "Invalid cursor") from exc
        statement = statement.order_by(Task.created_at.desc(), Task.task_id.desc()).limit(limit + 1)
        with self.factory() as session:
            rows = list(session.scalars(statement))
            items = [_task_response(row) for row in rows[:limit]]
            next_cursor = None
            if len(rows) > limit:
                last = rows[limit - 1]
                raw = json.dumps([last.created_at.isoformat(), last.task_id]).encode()
                next_cursor = base64.urlsafe_b64encode(raw).decode().rstrip("=")
            return TaskListResponse(items=items, next_cursor=next_cursor)

    def report_insights(self, user_id: str, limit: int = 10) -> list[dict[str, str]]:
        with self.factory() as session:
            rows = session.execute(
                select(Task.title, TaskReport.summary, TaskReport.blocker, TaskReport.next_step)
                .join(Task, Task.task_id == TaskReport.task_id)
                .where(TaskReport.user_id == user_id, TaskReport.analyzed_at.is_not(None))
                .order_by(TaskReport.created_at.desc())
                .limit(limit)
            )
            return [
                {
                    "task": title,
                    "summary": summary or "",
                    "blocker": blocker or "",
                    "next_step": next_step or "",
                }
                for title, summary, blocker, next_step in rows
            ]

    def create_proposal(
        self, user_id: str, body: ProposalCreateRequest, *, source: str = "manual"
    ) -> ProposalResponse:
        fingerprint = _fingerprint(body)
        now = _now()
        try:
            with self.factory.begin() as session:
                existing = session.scalar(
                    select(Proposal).where(
                        Proposal.user_id == user_id,
                        Proposal.client_request_id == body.client_request_id,
                    )
                )
                if existing:
                    if existing.request_fingerprint != fingerprint:
                        raise TaskFailure("IDEMPOTENCY_CONFLICT", 409, "Request key reused")
                    return _proposal_response(existing)
                if body.task_id:
                    task = session.scalar(
                        select(Task).where(Task.user_id == user_id, Task.task_id == body.task_id)
                    )
                    if task is None:
                        raise TaskFailure("NOT_FOUND", 404, "Task not found")
                    if task.version != body.expected_version:
                        raise TaskFailure("VERSION_CONFLICT", 409, "Task version changed")
                payload = body.task if body.operation == "create" else body.changes
                proposal = Proposal(
                    proposal_id=str(uuid4()),
                    user_id=user_id,
                    client_request_id=body.client_request_id,
                    request_fingerprint=fingerprint,
                    source=source,
                    operation=body.operation,
                    task_id=body.task_id,
                    expected_version=body.expected_version,
                    payload=payload.model_dump(mode="json", exclude_unset=True) if payload else {},
                    status="pending",
                    expires_at=now + timedelta(minutes=15),
                    created_at=now,
                    updated_at=now,
                )
                session.add(proposal)
                session.flush()
                return _proposal_response(proposal)
        except IntegrityError:
            with self.factory() as session:
                existing = session.scalar(
                    select(Proposal).where(
                        Proposal.user_id == user_id,
                        Proposal.client_request_id == body.client_request_id,
                    )
                )
                if existing and existing.request_fingerprint == fingerprint:
                    return _proposal_response(existing)
            raise TaskFailure("IDEMPOTENCY_CONFLICT", 409, "Request key reused") from None

    def create_agent_proposal_batch(
        self,
        user_id: str,
        run_id: str,
        call_id: str,
        tasks: list[TaskCreate],
    ) -> ProposalBatchResponse:
        if not 1 <= len(tasks) <= 10:
            raise TaskFailure("INVALID_REQUEST", 422, "A batch must contain 1 to 10 tasks")
        fingerprint = _batch_fingerprint(tasks)
        call_fingerprint = hashlib.sha256(call_id.encode()).hexdigest()
        request_id = f"agent-batch:{run_id}:{call_fingerprint}"
        now = _now()
        batch_id = str(uuid4())
        try:
            with self.factory.begin() as session:
                existing = session.scalar(
                    select(ProposalBatch).where(
                        ProposalBatch.user_id == user_id,
                        ProposalBatch.client_request_id == request_id,
                    )
                )
                if existing:
                    if existing.request_fingerprint != fingerprint:
                        raise TaskFailure("IDEMPOTENCY_CONFLICT", 409, "Request key reused")
                    return _batch_response(session, existing)
                run = session.scalar(
                    select(AgentRun).where(
                        AgentRun.user_id == user_id,
                        AgentRun.run_id == run_id,
                    )
                )
                if run is None:
                    raise TaskFailure("NOT_FOUND", 404, "Run not found")
                batch = ProposalBatch(
                    batch_id=batch_id,
                    user_id=user_id,
                    run_id=run_id,
                    client_request_id=request_id,
                    request_fingerprint=fingerprint,
                    status="pending",
                    expires_at=now + timedelta(minutes=15),
                    created_at=now,
                    updated_at=now,
                )
                session.add(batch)
                session.flush()
                for index, task in enumerate(tasks):
                    proposal = Proposal(
                        proposal_id=str(uuid4()),
                        batch_id=batch_id,
                        user_id=user_id,
                        client_request_id=f"agent-batch:{batch_id}:{index}",
                        request_fingerprint=hashlib.sha256(
                            task.model_dump_json().encode()
                        ).hexdigest(),
                        source="agent",
                        operation="create",
                        task_id=None,
                        expected_version=None,
                        payload=task.model_dump(mode="json"),
                        status="pending",
                        expires_at=batch.expires_at,
                        created_at=now,
                        updated_at=now,
                    )
                    session.add(proposal)
                session.flush()
                return _batch_response(session, batch)
        except IntegrityError:
            with self.factory() as session:
                existing = session.scalar(
                    select(ProposalBatch).where(
                        ProposalBatch.user_id == user_id,
                        ProposalBatch.client_request_id == request_id,
                    )
                )
                if existing and existing.request_fingerprint == fingerprint:
                    return _batch_response(session, existing)
            raise TaskFailure("IDEMPOTENCY_CONFLICT", 409, "Request key reused") from None

    def get_proposal(self, user_id: str, proposal_id: str) -> ProposalResponse:
        with self.factory() as session:
            proposal = session.scalar(
                select(Proposal).where(
                    Proposal.user_id == user_id, Proposal.proposal_id == proposal_id
                )
            )
            if proposal is None:
                raise TaskFailure("NOT_FOUND", 404, "Proposal not found")
            return _proposal_response(proposal)

    def proposals_for_run(self, user_id: str, run_id: str) -> list[ProposalResponse]:
        with self.factory() as session:
            proposals = session.scalars(
                select(Proposal)
                .where(
                    Proposal.user_id == user_id,
                    or_(
                        Proposal.client_request_id.startswith(f"agent:{run_id}:"),
                        Proposal.batch_id.in_(
                            select(ProposalBatch.batch_id).where(
                                ProposalBatch.user_id == user_id,
                                ProposalBatch.run_id == run_id,
                            )
                        ),
                    ),
                )
                .order_by(Proposal.created_at, Proposal.proposal_id)
            )
            return [_proposal_response(proposal) for proposal in proposals]

    def proposal_batches_for_run(self, user_id: str, run_id: str) -> list[ProposalBatchResponse]:
        with self.factory() as session:
            batches = session.scalars(
                select(ProposalBatch)
                .where(ProposalBatch.user_id == user_id, ProposalBatch.run_id == run_id)
                .order_by(ProposalBatch.created_at, ProposalBatch.batch_id)
            )
            return [_batch_response(session, batch) for batch in batches]

    def get_proposal_batch(self, user_id: str, batch_id: str) -> ProposalBatchResponse:
        with self.factory() as session:
            batch = session.scalar(
                select(ProposalBatch).where(
                    ProposalBatch.user_id == user_id,
                    ProposalBatch.batch_id == batch_id,
                )
            )
            if batch is None:
                raise TaskFailure("NOT_FOUND", 404, "Proposal batch not found")
            return _batch_response(session, batch)

    def update_proposal_batch_item(
        self, user_id: str, batch_id: str, proposal_id: str, task: TaskCreate
    ) -> ProposalBatchResponse:
        now = _now()
        with self.factory.begin() as session:
            batch = session.scalar(
                select(ProposalBatch)
                .where(ProposalBatch.user_id == user_id, ProposalBatch.batch_id == batch_id)
                .with_for_update()
            )
            if batch is None:
                raise TaskFailure("NOT_FOUND", 404, "Proposal batch not found")
            if batch.status != "pending" or now >= batch.expires_at:
                raise TaskFailure("PROPOSAL_UNAVAILABLE", 409, "Proposal batch is unavailable")
            proposal = session.scalar(
                select(Proposal)
                .where(
                    Proposal.user_id == user_id,
                    Proposal.batch_id == batch_id,
                    Proposal.proposal_id == proposal_id,
                )
                .with_for_update()
            )
            if proposal is None:
                raise TaskFailure("NOT_FOUND", 404, "Proposal not found")
            if proposal.status != "pending" or now >= proposal.expires_at:
                raise TaskFailure("PROPOSAL_UNAVAILABLE", 409, "Proposal is unavailable")
            proposal.payload = task.model_dump(mode="json")
            proposal.request_fingerprint = hashlib.sha256(
                task.model_dump_json().encode()
            ).hexdigest()
            proposal.updated_at = now
            batch.updated_at = now
            session.flush()
            return _batch_response(session, batch)

    def cancel_proposal_batch_item(
        self, user_id: str, batch_id: str, proposal_id: str
    ) -> ProposalBatchResponse:
        now = _now()
        with self.factory.begin() as session:
            batch = session.scalar(
                select(ProposalBatch)
                .where(ProposalBatch.user_id == user_id, ProposalBatch.batch_id == batch_id)
                .with_for_update()
            )
            if batch is None:
                raise TaskFailure("NOT_FOUND", 404, "Proposal batch not found")
            proposal = session.scalar(
                select(Proposal)
                .where(
                    Proposal.user_id == user_id,
                    Proposal.batch_id == batch_id,
                    Proposal.proposal_id == proposal_id,
                )
                .with_for_update()
            )
            if proposal is None:
                raise TaskFailure("NOT_FOUND", 404, "Proposal not found")
            if proposal.status == "cancelled":
                return _batch_response(session, batch)
            if (
                batch.status != "pending"
                or proposal.status != "pending"
                or now >= batch.expires_at
                or now >= proposal.expires_at
            ):
                raise TaskFailure("PROPOSAL_UNAVAILABLE", 409, "Proposal is unavailable")
            proposal.status = "cancelled"
            proposal.updated_at = now
            batch.updated_at = now
            remaining = session.scalar(
                select(Proposal.proposal_id)
                .where(Proposal.batch_id == batch_id, Proposal.status == "pending")
                .limit(1)
            )
            if remaining is None:
                batch.status = "cancelled"
            session.flush()
            return _batch_response(session, batch)

    def confirm_proposal_batch(
        self, user_id: str, batch_id: str, key: str
    ) -> ProposalBatchConfirmationReceipt:
        key_hash = hashlib.sha256(key.encode()).hexdigest()
        now = _now()
        with self.factory.begin() as session:
            batch = session.scalar(
                select(ProposalBatch)
                .where(ProposalBatch.user_id == user_id, ProposalBatch.batch_id == batch_id)
                .with_for_update()
            )
            if batch is None:
                raise TaskFailure("NOT_FOUND", 404, "Proposal batch not found")
            if batch.status == "confirmed":
                if batch.confirm_key_hash != key_hash:
                    raise TaskFailure("IDEMPOTENCY_CONFLICT", 409, "Confirmation key differs")
                return ProposalBatchConfirmationReceipt.model_validate(batch.receipt)
            if batch.status == "cancelled":
                raise TaskFailure("PROPOSAL_BATCH_EMPTY", 409, "No pending items remain")
            if batch.status != "pending":
                raise TaskFailure("PROPOSAL_UNAVAILABLE", 409, "Proposal batch is unavailable")
            proposals = list(
                session.scalars(
                    select(Proposal)
                    .where(Proposal.user_id == user_id, Proposal.batch_id == batch_id)
                    .order_by(Proposal.created_at, Proposal.proposal_id)
                    .with_for_update()
                )
            )
            pending = [proposal for proposal in proposals if proposal.status == "pending"]
            if not pending:
                raise TaskFailure("PROPOSAL_BATCH_EMPTY", 409, "No pending items remain")
            if now >= batch.expires_at or any(now >= proposal.expires_at for proposal in pending):
                raise TaskFailure("PROPOSAL_EXPIRED", 409, "Proposal batch expired")
            if any(proposal.status not in {"pending", "cancelled"} for proposal in proposals):
                raise TaskFailure("PROPOSAL_UNAVAILABLE", 409, "Proposal batch state changed")

            tasks: list[TaskResponse] = []
            for proposal in pending:
                fields = TaskCreate.model_validate(proposal.payload)
                task = Task(
                    task_id=str(uuid4()),
                    user_id=user_id,
                    title=fields.title,
                    description=fields.description,
                    category=fields.category,
                    importance=fields.importance,
                    urgency=fields.urgency,
                    status="open",
                    version=1,
                    created_at=now,
                    updated_at=now,
                )
                _set_due(task, fields.due)
                session.add(task)
                session.flush()
                response = _task_response(task)
                tasks.append(response)
                proposal.status = "confirmed"
                proposal.task_id = task.task_id
                proposal.confirm_key_hash = key_hash
                proposal.receipt = ConfirmationReceipt(
                    proposal_id=proposal.proposal_id,
                    operation=proposal.operation,
                    task_id=task.task_id,
                    task=response,
                ).model_dump(mode="json")
                proposal.updated_at = now
            receipt = ProposalBatchConfirmationReceipt(
                batch_id=batch_id,
                confirmed_count=len(tasks),
                tasks=tasks,
            )
            batch.status = "confirmed"
            batch.confirm_key_hash = key_hash
            batch.receipt = receipt.model_dump(mode="json")
            batch.updated_at = now
            return receipt

    def confirm(self, user_id: str, proposal_id: str, key: str) -> ConfirmationReceipt:
        key_hash = hashlib.sha256(key.encode()).hexdigest()
        now = _now()
        with self.factory.begin() as session:
            preliminary = session.scalar(
                select(Proposal).where(
                    Proposal.user_id == user_id, Proposal.proposal_id == proposal_id
                )
            )
            if preliminary is None:
                raise TaskFailure("NOT_FOUND", 404, "Proposal not found")
            task = None
            if preliminary.task_id:
                task = session.scalar(
                    select(Task)
                    .where(Task.user_id == user_id, Task.task_id == preliminary.task_id)
                    .with_for_update()
                )
            proposal = session.scalar(
                select(Proposal)
                .where(Proposal.user_id == user_id, Proposal.proposal_id == proposal_id)
                .with_for_update()
            )
            if proposal.status == "confirmed":
                if proposal.confirm_key_hash != key_hash:
                    raise TaskFailure("IDEMPOTENCY_CONFLICT", 409, "Confirmation key differs")
                return ConfirmationReceipt.model_validate(proposal.receipt)
            if proposal.status != "pending":
                raise TaskFailure("PROPOSAL_UNAVAILABLE", 409, "Proposal not pending")
            if proposal.batch_id is not None:
                raise TaskFailure(
                    "PROPOSAL_BATCH_CONFIRM_REQUIRED",
                    409,
                    "Use the proposal batch confirmation endpoint",
                )
            if now >= proposal.expires_at:
                raise TaskFailure("PROPOSAL_EXPIRED", 409, "Proposal expired")
            if proposal.operation != "create" and task is None:
                raise TaskFailure("NOT_FOUND", 404, "Task not found")
            if task is not None and task.version != proposal.expected_version:
                raise TaskFailure("VERSION_CONFLICT", 409, "Task version changed")
            if proposal.operation == "create":
                fields = TaskCreate.model_validate(proposal.payload)
                task = Task(
                    task_id=str(uuid4()),
                    user_id=user_id,
                    title=fields.title,
                    description=fields.description,
                    category=fields.category,
                    importance=fields.importance,
                    urgency=fields.urgency,
                    status="open",
                    version=1,
                    created_at=now,
                    updated_at=now,
                )
                _set_due(task, fields.due)
                session.add(task)
                session.flush()
                proposal.task_id = task.task_id
            elif proposal.operation == "update":
                changes = TaskPatch.model_validate(proposal.payload)
                for field in changes.model_fields_set:
                    if field == "due":
                        _set_due(task, changes.due)
                    else:
                        setattr(task, field, getattr(changes, field))
                task.version += 1
                task.updated_at = now
            elif proposal.operation == "complete":
                task.status = "completed"
                task.version += 1
                task.updated_at = now
            else:
                session.execute(
                    update(Proposal)
                    .where(
                        Proposal.user_id == user_id,
                        Proposal.task_id == task.task_id,
                        Proposal.status == "pending",
                        Proposal.proposal_id != proposal_id,
                    )
                    .values(status="invalidated", updated_at=now)
                )
                session.delete(task)
            receipt = ConfirmationReceipt(
                proposal_id=proposal_id,
                operation=proposal.operation,
                task_id=task.task_id,
                task=None if proposal.operation == "delete" else _task_response(task),
            )
            proposal.status = "confirmed"
            proposal.confirm_key_hash = key_hash
            proposal.receipt = receipt.model_dump(mode="json")
            proposal.updated_at = now
            return receipt

    def cancel(self, user_id: str, proposal_id: str) -> None:
        with self.factory.begin() as session:
            proposal = session.scalar(
                select(Proposal)
                .where(Proposal.user_id == user_id, Proposal.proposal_id == proposal_id)
                .with_for_update()
            )
            if proposal is None:
                raise TaskFailure("NOT_FOUND", 404, "Proposal not found")
            if proposal.status == "cancelled":
                return
            if proposal.status != "pending":
                raise TaskFailure("PROPOSAL_UNAVAILABLE", 409, "Proposal not pending")
            proposal.status = "cancelled"
            proposal.updated_at = _now()
