from datetime import date, datetime
from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from assistant_backend.domain.tasks import (
    clean_optional_text,
    clean_title,
    validate_minute_due,
    validate_timezone,
)


class TaskStatus(StrEnum):
    OPEN = "open"
    COMPLETED = "completed"


class DateDue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    precision: Literal["date"]
    date: date
    timezone: str

    @field_validator("timezone")
    @classmethod
    def timezone_is_valid(cls, value: str) -> str:
        return validate_timezone(value)


class MinuteDue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    precision: Literal["minute"]
    at: datetime
    timezone: str

    @model_validator(mode="after")
    def minute_and_timezone_match(self) -> "MinuteDue":
        validate_minute_due(self.at, self.timezone)
        return self


Due = Annotated[DateDue | MinuteDue, Field(discriminator="precision")]
Score = Annotated[float, Field(strict=True, ge=0, le=10, multiple_of=0.1)]


class TaskCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str
    description: str | None = None
    category: str | None = None
    due: Due | None = None
    importance: Score = 5.0
    urgency: Score = 3.0

    @field_validator("title")
    @classmethod
    def title_is_valid(cls, value: str) -> str:
        return clean_title(value)

    @field_validator("description")
    @classmethod
    def description_is_valid(cls, value: str | None) -> str | None:
        return clean_optional_text(value, 2000)

    @field_validator("category")
    @classmethod
    def category_is_valid(cls, value: str | None) -> str | None:
        return clean_optional_text(value, 64)


class TaskPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = None
    description: str | None = None
    category: str | None = None
    due: Due | None = None
    importance: Score | None = None
    urgency: Score | None = None

    @model_validator(mode="after")
    def nonempty_and_required_values(self) -> "TaskPatch":
        if not self.model_fields_set:
            raise ValueError("At least one task field is required")
        for field in ("title", "importance", "urgency"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self

    @field_validator("title")
    @classmethod
    def title_is_valid(cls, value: str | None) -> str | None:
        return clean_title(value) if value is not None else None

    @field_validator("description")
    @classmethod
    def description_is_valid(cls, value: str | None) -> str | None:
        return clean_optional_text(value, 2000)

    @field_validator("category")
    @classmethod
    def category_is_valid(cls, value: str | None) -> str | None:
        return clean_optional_text(value, 64)


class TaskResponse(TaskCreate):
    model_config = ConfigDict(extra="forbid")

    task_id: str
    status: TaskStatus
    version: int = Field(ge=1)
    created_at: datetime
    updated_at: datetime


class TaskListResponse(BaseModel):
    items: list[TaskResponse]
    next_cursor: str | None = None


class ProposalOperation(StrEnum):
    CREATE = "create"
    UPDATE = "update"
    COMPLETE = "complete"
    DELETE = "delete"


class ProposalCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    client_request_id: str = Field(min_length=1, max_length=128)
    operation: ProposalOperation
    task_id: str | None = None
    expected_version: int | None = Field(default=None, ge=1)
    task: TaskCreate | None = None
    changes: TaskPatch | None = None

    @model_validator(mode="after")
    def operation_fields_match(self) -> "ProposalCreateRequest":
        if self.operation == ProposalOperation.CREATE:
            valid = (
                self.task is not None
                and self.task_id is None
                and self.expected_version is None
                and self.changes is None
            )
        elif self.operation == ProposalOperation.UPDATE:
            valid = (
                self.task_id is not None
                and self.expected_version is not None
                and self.changes is not None
                and self.task is None
            )
        else:
            valid = (
                self.task_id is not None
                and self.expected_version is not None
                and self.task is None
                and self.changes is None
            )
        if not valid:
            raise ValueError("Proposal fields do not match operation")
        return self


class ProposalResponse(BaseModel):
    proposal_id: str
    operation: ProposalOperation
    task_id: str | None = None
    expected_version: int | None = None
    task: TaskCreate | None = None
    changes: TaskPatch | None = None
    status: str
    expires_at: datetime


class ProposalConfirmationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    idempotency_key: str = Field(min_length=1, max_length=128)


class ConfirmationReceipt(BaseModel):
    proposal_id: str
    operation: ProposalOperation
    task_id: str
    task: TaskResponse | None = None
    status: Literal["confirmed"] = "confirmed"


class ProposalBatchResponse(BaseModel):
    batch_id: str
    run_id: str
    status: Literal["pending", "confirmed", "cancelled", "expired"]
    proposals: list[ProposalResponse]
    expires_at: datetime
    created_at: datetime


class ProposalBatchConfirmationReceipt(BaseModel):
    batch_id: str
    status: Literal["confirmed"] = "confirmed"
    confirmed_count: int
    tasks: list[TaskResponse]
