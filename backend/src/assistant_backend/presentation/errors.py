from typing import Any

from pydantic import BaseModel, ConfigDict


class ErrorResponse(BaseModel):
    """Stable error envelope shared by JSON endpoints."""

    model_config = ConfigDict(extra="forbid")

    code: str
    message: str
    request_id: str
    details: dict[str, Any] | None = None
    retryable: bool = False
