import json
import time
from collections.abc import Iterator
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query, Request, Response
from fastapi.responses import StreamingResponse

from assistant_backend.application.agent_dto import RunEventView, RunStatus
from assistant_backend.application.agent_runs import AgentRunService, RunFailure
from assistant_backend.application.identity import SessionIdentity
from assistant_backend.presentation.agent_schemas import (
    MessageSubmitRequest,
    ProposalIdsResponse,
    RunAcceptedResponse,
    RunStatusResponse,
)
from assistant_backend.presentation.auth import get_identity, require_csrf, require_origin
from assistant_backend.presentation.errors import ErrorResponse


router = APIRouter(
    prefix="/api",
    tags=["agent-runs"],
    responses={
        401: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        429: {"model": ErrorResponse},
    },
)


def get_service(request: Request) -> AgentRunService:
    return request.app.state.agent_run_service


@router.post(
    "/conversations/{conversation_id}/messages",
    response_model=RunAcceptedResponse,
    status_code=202,
    dependencies=[Depends(require_origin), Depends(require_csrf)],
)
def submit_message(
    conversation_id: str,
    body: MessageSubmitRequest,
    request: Request,
    identity: Annotated[SessionIdentity, Depends(get_identity)],
    service: Annotated[AgentRunService, Depends(get_service)],
) -> RunAcceptedResponse:
    ip_address = request.client.host if request.client else "unknown"
    accepted = service.submit_message(
        identity.user_id,
        ip_address,
        conversation_id,
        body.client_message_id,
        body.content,
    )
    return RunAcceptedResponse(**accepted.__dict__)


@router.get("/runs/{run_id}", response_model=RunStatusResponse)
def get_run(
    run_id: str,
    identity: Annotated[SessionIdentity, Depends(get_identity)],
    service: Annotated[AgentRunService, Depends(get_service)],
) -> RunStatusResponse:
    return RunStatusResponse(**service.get(identity.user_id, run_id).__dict__)


@router.get("/conversations/{conversation_id}/proposal-ids", response_model=ProposalIdsResponse)
def get_pending_conversation_proposals(
    conversation_id: str,
    identity: Annotated[SessionIdentity, Depends(get_identity)],
    service: Annotated[AgentRunService, Depends(get_service)],
) -> ProposalIdsResponse:
    return ProposalIdsResponse(
        proposal_ids=service.pending_proposal_ids(identity.user_id, conversation_id)
    )


def _sse(event: RunEventView) -> str:
    data = json.dumps(event.payload, ensure_ascii=False, separators=(",", ":"))
    return f"id: {event.sequence}\nevent: {event.event_type}\ndata: {data}\n\n"


def _snapshot(status: RunStatus) -> str:
    payload = {
        "run_id": status.run_id,
        "status": status.status,
        "phase": status.phase,
        "assistant_message_id": status.assistant_message_id,
        "assistant_content": status.assistant_content,
        "last_event_sequence": status.last_event_sequence,
    }
    data = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    return (
        f"id: {status.last_event_sequence}\nevent: run.snapshot\ndata: {data}\n\n"
        if status.last_event_sequence
        else f"event: run.snapshot\ndata: {data}\n\n"
    )


def _event_stream(
    service: AgentRunService, user_id: str, run_id: str, sequence: int
) -> Iterator[str]:
    try:
        status = service.status_for_stream(user_id, run_id)
        if service.expired_cursor(run_id, sequence):
            yield _snapshot(status)
            sequence = status.last_event_sequence
    except RunFailure as exc:
        if exc.code == "NOT_FOUND":
            return
        raise

    last_heartbeat = time.monotonic()
    while True:
        try:
            events = service.events_after(user_id, run_id, sequence)
            if events:
                for event in events:
                    yield _sse(event)
                    sequence = event.sequence
                last_heartbeat = time.monotonic()
            status = service.status_for_stream(user_id, run_id)
        except RunFailure as exc:
            if exc.code == "NOT_FOUND":
                return
            raise
        if (
            status.status in {"completed", "failed", "cancelled"}
            and sequence >= status.last_event_sequence
        ):
            return
        if time.monotonic() - last_heartbeat >= 15:
            yield ": keep-alive\n\n"
            last_heartbeat = time.monotonic()
        time.sleep(0.5)


@router.get(
    "/runs/{run_id}/events",
    responses={200: {"content": {"text/event-stream": {}}}},
)
def stream_run_events(
    run_id: str,
    identity: Annotated[SessionIdentity, Depends(get_identity)],
    service: Annotated[AgentRunService, Depends(get_service)],
    last_event_id: Annotated[str | None, Header(alias="Last-Event-ID")] = None,
    after: int | None = Query(default=None, ge=0),
) -> Response:
    status = service.get(identity.user_id, run_id)
    if last_event_id is not None:
        try:
            header_sequence = int(last_event_id)
            if header_sequence < 0:
                raise ValueError
        except ValueError as exc:
            raise RunFailure("INVALID_REQUEST", 422, "Invalid event cursor") from exc
        if after is not None and after != header_sequence:
            raise RunFailure("INVALID_REQUEST", 422, "Conflicting event cursors")
        sequence = header_sequence
    else:
        sequence = after or 0
    if sequence > status.last_event_sequence:
        raise RunFailure("INVALID_REQUEST", 422, "Event cursor is ahead of the run")
    return StreamingResponse(
        _event_stream(service, identity.user_id, run_id, sequence),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
