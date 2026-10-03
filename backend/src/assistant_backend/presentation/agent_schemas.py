from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class MessageSubmitRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    client_message_id: str = Field(min_length=1, max_length=128)
    content: str = Field(min_length=1, max_length=8000)

    @field_validator("content")
    @classmethod
    def content_is_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Message content must not be blank")
        return value


class RunAcceptedResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: str
    status: Literal["queued", "running", "completed", "failed", "cancelled"]
    created_at: datetime
    replayed: bool


class ProposalIdsResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    proposal_ids: list[str]


class RunStatusResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: str
    status: Literal["queued", "running", "completed", "failed", "cancelled"]
    phase: str
    user_message_id: str
    assistant_message_id: str | None
    assistant_content: str | None
    error_code: str | None
    created_at: datetime
    updated_at: datetime
    last_event_sequence: int
