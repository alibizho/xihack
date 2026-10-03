"""Completion reports persist before optional AI analysis."""

from collections.abc import Callable
from datetime import datetime, timezone
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from assistant_backend.application.tasks import TaskFailure
from assistant_backend.infrastructure.models import Task, TaskReport


class ReportInsight(BaseModel):
    model_config = ConfigDict(extra="forbid")

    summary: str = Field(min_length=1, max_length=240)
    blocker: str = Field(default="", max_length=240)
    next_step: str = Field(default="", max_length=240)


class ReportView(BaseModel):
    report_id: str
    task_id: str
    body: str
    summary: str | None
    blocker: str | None
    next_step: str | None
    status: str
    created_at: datetime


def _view(report: TaskReport) -> ReportView:
    status = (
        "analyzed"
        if report.analyzed_at
        else "unavailable"
        if report.analysis_attempts >= 3
        else "pending"
    )
    return ReportView(
        report_id=report.report_id,
        task_id=report.task_id,
        body=report.body,
        summary=report.summary,
        blocker=report.blocker,
        next_step=report.next_step,
        status=status,
        created_at=report.created_at,
    )


class ReportService:
    def __init__(
        self,
        factory: sessionmaker[Session],
        analyzer: Callable[[str, str], ReportInsight],
    ) -> None:
        self.factory = factory
        self.analyzer = analyzer

    def submit(self, user_id: str, task_id: str, body: str) -> ReportView:
        clean = body.strip()
        if not clean or len(clean) > 2000:
            raise TaskFailure("INVALID_REQUEST", 422, "Report must be 1–2000 characters")
        try:
            with self.factory.begin() as session:
                task = session.scalar(
                    select(Task)
                    .where(Task.user_id == user_id, Task.task_id == task_id)
                    .with_for_update()
                )
                if task is None:
                    raise TaskFailure("NOT_FOUND", 404, "Task not found")
                if task.status != "completed":
                    raise TaskFailure("TASK_NOT_COMPLETED", 409, "Task must be completed first")
                report = session.scalar(
                    select(TaskReport).where(
                        TaskReport.user_id == user_id, TaskReport.task_id == task_id
                    )
                )
                if report is None:
                    report = TaskReport(
                        report_id=str(uuid4()),
                        user_id=user_id,
                        task_id=task_id,
                        body=clean,
                        summary=None,
                        blocker=None,
                        next_step=None,
                        analysis_attempts=0,
                        created_at=datetime.now(timezone.utc),
                        analyzed_at=None,
                    )
                    session.add(report)
                elif report.body != clean:
                    raise TaskFailure("REPORT_EXISTS", 409, "This task already has a report")
        except IntegrityError:
            with self.factory() as session:
                report = session.scalar(
                    select(TaskReport).where(
                        TaskReport.user_id == user_id, TaskReport.task_id == task_id
                    )
                )
                if report is None or report.body != clean:
                    raise TaskFailure(
                        "REPORT_EXISTS", 409, "This task already has a report"
                    ) from None
        self._analyze(user_id, task_id)
        return self.get(user_id, task_id)

    def get(self, user_id: str, task_id: str) -> ReportView:
        with self.factory() as session:
            report = session.scalar(
                select(TaskReport).where(
                    TaskReport.user_id == user_id, TaskReport.task_id == task_id
                )
            )
            if report is None:
                raise TaskFailure("NOT_FOUND", 404, "Report not found")
            return _view(report)

    def _analyze(self, user_id: str, task_id: str) -> None:
        with self.factory.begin() as session:
            report = session.scalar(
                select(TaskReport)
                .where(TaskReport.user_id == user_id, TaskReport.task_id == task_id)
                .with_for_update()
            )
            if report is None or report.analyzed_at or report.analysis_attempts >= 3:
                return
            task = session.scalar(
                select(Task).where(Task.user_id == user_id, Task.task_id == task_id)
            )
            if task is None:
                return
            report.analysis_attempts += 1
            title, body = task.title, report.body
        try:
            insight = self.analyzer(title, body)
        except Exception:
            return
        with self.factory.begin() as session:
            report = session.scalar(
                select(TaskReport)
                .where(TaskReport.user_id == user_id, TaskReport.task_id == task_id)
                .with_for_update()
            )
            if report is not None and report.analyzed_at is None:
                report.summary = insight.summary
                report.blocker = insight.blocker
                report.next_step = insight.next_step
                report.analyzed_at = datetime.now(timezone.utc)
