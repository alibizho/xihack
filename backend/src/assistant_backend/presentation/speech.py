"""Authenticated ephemeral speech draft endpoints."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, Query, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from starlette.concurrency import run_in_threadpool

from assistant_backend.application.identity import SessionIdentity
from assistant_backend.application.speech import (
    MAX_AUDIO_BYTES,
    SpeechFailure,
    SpeechService,
    calibrate,
)
from assistant_backend.presentation.auth import get_identity, require_csrf, require_origin
from assistant_backend.presentation.errors import ErrorResponse


router = APIRouter(
    prefix="/api/transcriptions",
    tags=["speech"],
    responses={
        401: {"model": ErrorResponse},
        403: {"model": ErrorResponse},
        413: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
        429: {"model": ErrorResponse},
        503: {"model": ErrorResponse},
    },
)


class SpeechDraftRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=8000)
    timezone: str = Field(min_length=1, max_length=128)
    confidence: float | None = Field(default=None, ge=0, le=1)

    @field_validator("text")
    @classmethod
    def nonblank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Blank draft")
        return value


class SpeechDraftResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    draft_text: str
    intent: Literal["create", "update", "complete", "delete", "query", "unclear"]
    due: dict | None
    needs_clarification: bool
    clarification: str | None
    fallback_suggested: bool


def get_service(request: Request) -> SpeechService:
    return request.app.state.speech_service


@router.post(
    "",
    response_model=SpeechDraftResponse,
    dependencies=[Depends(require_origin), Depends(require_csrf)],
)
def calibrate_draft(
    body: SpeechDraftRequest,
    identity: Annotated[SessionIdentity, Depends(get_identity)],
) -> SpeechDraftResponse:
    del identity
    return SpeechDraftResponse.model_validate(calibrate(body.text, body.timezone, body.confidence))


@router.post(
    "/audio",
    response_model=SpeechDraftResponse,
    dependencies=[Depends(require_origin), Depends(require_csrf)],
)
async def audio_fallback(
    request: Request,
    identity: Annotated[SessionIdentity, Depends(get_identity)],
    service: Annotated[SpeechService, Depends(get_service)],
    timezone_name: str = Query(alias="timezone", min_length=1, max_length=128),
    reason: Literal["low_confidence", "user_retry", "unresolved"] = Query(),
    audio_consent: Annotated[str | None, Header(alias="X-Audio-Consent")] = None,
) -> SpeechDraftResponse:
    del reason
    if audio_consent != "true":
        raise SpeechFailure("AUDIO_CONSENT_REQUIRED", 403, "Audio consent required")
    if request.headers.get("content-type", "").split(";", 1)[0].strip() != "audio/wav":
        raise SpeechFailure("AUDIO_INVALID", 422, "Unsupported audio format")
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > MAX_AUDIO_BYTES:
            raise SpeechFailure("AUDIO_LIMIT_EXCEEDED", 413, "Audio size limit exceeded")
    ip_address = request.client.host if request.client else "unknown"
    result = await run_in_threadpool(
        service.audio_fallback, identity.user_id, ip_address, bytes(data), timezone_name
    )
    return SpeechDraftResponse.model_validate(result)
