from dataclasses import dataclass
from datetime import datetime
from typing import Any


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
