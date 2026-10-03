from dataclasses import dataclass
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field
from typing import Literal


class StructuredAgentResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    result_type: Literal["message", "task_query", "advice", "clarification", "proposal_bundle"]
    message: str = Field(min_length=1, max_length=1200)
    task_refs: list[str] = Field(max_length=10)
    recommended_task_id: str = Field(max_length=36)
    suggested_prompts: list[str] = Field(max_length=3)


@dataclass(frozen=True)
class RunAccepted:
    run_id: str
    status: str
    created_at: datetime
    replayed: bool


@dataclass(frozen=True)
class RunStatus:
    run_id: str
    status: str
    phase: str
    user_message_id: str
    assistant_message_id: str | None
    assistant_content: str | None
    structured_result: StructuredAgentResult | None
    error_code: str | None
    created_at: datetime
    updated_at: datetime
    last_event_sequence: int


@dataclass(frozen=True)
class RunEventView:
    sequence: int
    event_type: str
    payload: dict[str, Any]
    created_at: datetime
