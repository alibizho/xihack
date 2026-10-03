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

from assistant_backend.infrastructure.models import Proposal, Task
from assistant_backend.presentation.schemas import (
    ConfirmationReceipt,
    DateDue,
    MinuteDue,
    ProposalCreateRequest,
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
        important=task.important,
        urgent=task.urgent,
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
            statement = statement.where(Task.important == important)
        if urgent is not None:
            statement = statement.where(Task.urgent == urgent)
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
                    important=fields.important,
                    urgent=fields.urgent,
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
