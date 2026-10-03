from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Body, Depends, Query, Request

from assistant_backend.application.identity import SessionIdentity
from assistant_backend.application.tasks import TaskService
from assistant_backend.presentation.auth import get_identity, require_csrf, require_origin
from assistant_backend.presentation.errors import ErrorResponse
from assistant_backend.presentation.schemas import (
    ConfirmationReceipt,
    ProposalConfirmationRequest,
    ProposalCreateRequest,
    ProposalResponse,
    TaskListResponse,
    TaskResponse,
)


router = APIRouter(
    prefix="/api",
    tags=["tasks"],
    responses={
        401: {"model": ErrorResponse},
        403: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        409: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
    },
)


def get_service(request: Request) -> TaskService:
    return request.app.state.task_service


@router.get("/tasks", response_model=TaskListResponse)
def list_tasks(
    identity: Annotated[SessionIdentity, Depends(get_identity)],
    service: Annotated[TaskService, Depends(get_service)],
    keyword: str | None = Query(default=None, max_length=200),
    due_from: date | None = None,
    due_to: date | None = None,
    important: bool | None = None,
    urgent: bool | None = None,
    status: Literal["open", "completed"] | None = None,
    category: str | None = Query(default=None, max_length=64),
    limit: int = Query(default=20, ge=1, le=100),
    cursor: str | None = Query(default=None, max_length=512),
) -> TaskListResponse:
    return service.list(
        identity.user_id,
        keyword=keyword,
        due_from=due_from,
        due_to=due_to,
        important=important,
        urgent=urgent,
        status=status,
        category=category,
        limit=limit,
        cursor=cursor,
    )


@router.get("/tasks/{task_id}", response_model=TaskResponse)
def get_task(
    task_id: str,
    identity: Annotated[SessionIdentity, Depends(get_identity)],
    service: Annotated[TaskService, Depends(get_service)],
) -> TaskResponse:
    return service.get(identity.user_id, task_id)


@router.post(
    "/proposals",
    response_model=ProposalResponse,
    status_code=201,
    dependencies=[Depends(require_origin), Depends(require_csrf)],
)
def create_proposal(
    body: Annotated[
        ProposalCreateRequest,
        Body(
            openapi_examples={
                "create_task": {
                    "summary": "Save a task creation preview",
                    "value": {
                        "client_request_id": "client-001",
                        "operation": "create",
                        "task": {
                            "title": "完成项目周报",
                            "important": True,
                            "urgent": False,
                            "due": {
                                "precision": "date",
                                "date": "2026-10-09",
                                "timezone": "Asia/Shanghai",
                            },
                        },
                    },
                },
            }
        ),
    ],
    identity: Annotated[SessionIdentity, Depends(get_identity)],
    service: Annotated[TaskService, Depends(get_service)],
) -> ProposalResponse:
    return service.create_proposal(identity.user_id, body)


@router.get("/proposals/{proposal_id}", response_model=ProposalResponse)
def get_proposal(
    proposal_id: str,
    identity: Annotated[SessionIdentity, Depends(get_identity)],
    service: Annotated[TaskService, Depends(get_service)],
) -> ProposalResponse:
    return service.get_proposal(identity.user_id, proposal_id)


@router.post(
    "/proposals/{proposal_id}/confirm",
    response_model=ConfirmationReceipt,
    dependencies=[Depends(require_origin), Depends(require_csrf)],
)
def confirm_proposal(
    proposal_id: str,
    body: Annotated[
        ProposalConfirmationRequest,
        Body(
            openapi_examples={
                "confirm": {
                    "summary": "Confirm a saved proposal",
                    "value": {"idempotency_key": "confirm-001"},
                },
            }
        ),
    ],
    identity: Annotated[SessionIdentity, Depends(get_identity)],
    service: Annotated[TaskService, Depends(get_service)],
) -> ConfirmationReceipt:
    return service.confirm(identity.user_id, proposal_id, body.idempotency_key)


@router.post(
    "/proposals/{proposal_id}/cancel",
    status_code=204,
    dependencies=[Depends(require_origin), Depends(require_csrf)],
)
def cancel_proposal(
    proposal_id: str,
    identity: Annotated[SessionIdentity, Depends(get_identity)],
    service: Annotated[TaskService, Depends(get_service)],
) -> None:
    service.cancel(identity.user_id, proposal_id)
