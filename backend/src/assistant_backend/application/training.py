"""Account-scoped compact focus-training summaries for planning context."""

from datetime import datetime, timedelta, timezone
from statistics import fmean
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, sessionmaker

from assistant_backend.infrastructure.models import TrainingRoundSummary


class TrainingSummaryInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    client_round_id: str = Field(min_length=1, max_length=36)
    day_period: str = Field(pattern="^(morning|afternoon|evening|night)$")
    difficulty: str = Field(pattern="^(beginner|normal|advanced)$")
    variant: str = Field(pattern="^(grid|circle)$")
    duration_seconds: float = Field(gt=0, le=1200)
    mistakes: int = Field(ge=0, le=500)
    average_step_seconds: float = Field(gt=0, le=60)
    first_half_seconds: float = Field(gt=0, le=60)
    second_half_seconds: float = Field(gt=0, le=60)
    max_pause_seconds: float = Field(gt=0, le=1200)
    completed_at: datetime


class TrainingSummaryService:
    def __init__(self, factory: sessionmaker[Session]) -> None:
        self.factory = factory

    def save(self, user_id: str, body: TrainingSummaryInput) -> None:
        values = body.model_dump()
        values["summary_id"] = str(uuid4())
        values["user_id"] = user_id
        values["completed_at"] = body.completed_at.astimezone(timezone.utc)
        statement = insert(TrainingRoundSummary).values(**values)
        statement = statement.on_conflict_do_nothing(
            constraint="uq_training_summary_user_round"
        )
        with self.factory.begin() as session:
            session.execute(statement)
            session.execute(
                delete(TrainingRoundSummary).where(
                    TrainingRoundSummary.user_id == user_id,
                    TrainingRoundSummary.completed_at < datetime.now(timezone.utc) - timedelta(days=90),
                )
            )

    def recent(self, user_id: str, day_period: str) -> dict:
        with self.factory() as session:
            recent = list(
                session.scalars(
                    select(TrainingRoundSummary)
                    .where(TrainingRoundSummary.user_id == user_id)
                    .order_by(TrainingRoundSummary.completed_at.desc())
                    .limit(24)
                )
            )
        same_period_all = [row for row in recent if row.day_period == day_period]
        same_period = same_period_all[:6]
        latest = recent[:6]
        if not recent:
            return {
                "available": False,
                "current_period": day_period,
                "sample_count": 0,
                "trend": "insufficient_data",
                "same_period_count": 0,
            }
        older = recent[6:12]
        faster = [row.duration_seconds for row in latest]
        slower = [row.duration_seconds for row in older]
        trend = "insufficient_data"
        same_period_trend = "insufficient_data"
        if len(latest) >= 3 and len(older) >= 3:
            new_average, old_average = fmean(faster), fmean(slower)
            trend = "faster" if new_average < old_average * 0.9 else "slower" if new_average > old_average * 1.1 else "stable"
        same_recent = same_period_all[:3]
        same_older = same_period_all[3:6]
        if len(same_recent) == 3 and len(same_older) == 3:
            current_average = fmean(row.duration_seconds for row in same_recent)
            previous_average = fmean(row.duration_seconds for row in same_older)
            same_period_trend = "faster" if current_average < previous_average * 0.9 else "slower" if current_average > previous_average * 1.1 else "stable"
        baseline = recent[1:6]
        latest_deviates = False
        if recent and len(baseline) >= 3:
            baseline_average = fmean(row.duration_seconds for row in baseline)
            latest_deviates = recent[0].duration_seconds > baseline_average * 1.5 or recent[0].duration_seconds < baseline_average * 0.6
        return {
            "available": True,
            "current_period": day_period,
            "sample_count": len(latest),
            "average_duration_seconds": round(fmean(row.duration_seconds for row in latest), 1),
            "average_step_seconds": round(fmean(row.average_step_seconds for row in latest), 2),
            "average_mistakes": round(fmean(row.mistakes for row in latest), 1),
            "average_max_pause_seconds": round(fmean(row.max_pause_seconds for row in latest), 1),
            "later_half_change_seconds": round(
                fmean(row.second_half_seconds - row.first_half_seconds for row in latest), 2
            ),
            "trend": trend,
            "same_period_count": len(same_period),
            "same_period_trend": same_period_trend,
            "latest_round_deviates": latest_deviates,
            "same_period_average_duration_seconds": (
                round(fmean(row.duration_seconds for row in same_period), 1)
                if same_period
                else None
            ),
        }
