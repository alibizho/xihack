from typing import Annotated

from fastapi import APIRouter, Body, Depends, Query, Request, Response

from assistant_backend.application.conversation_dto import (
    CreateConversation,
    UpdateConversationTitle,
)
from assistant_backend.application.conversations import ConversationService
from assistant_backend.application.identity import SessionIdentity
from assistant_backend.presentation.auth import get_identity, require_csrf, require_origin
from assistant_backend.presentation.conversation_schemas import (
    ConversationCreateRequest,
    ConversationDetailResponse,
    ConversationListResponse,
    ConversationResponse,
    ConversationTitleRequest,
)
from assistant_backend.presentation.errors import ErrorResponse


router = APIRouter(
    prefix="/api/conversations",
    tags=["conversations"],
    responses={
        401: {"model": ErrorResponse},
        403: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        409: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
    },
)


def get_service(request: Request) -> ConversationService:
    return request.app.state.conversation_service


@router.get("", response_model=ConversationListResponse)
def list_conversations(
    identity: Annotated[SessionIdentity, Depends(get_identity)],
    service: Annotated[ConversationService, Depends(get_service)],
    limit: int = Query(default=20, ge=1, le=100),
    cursor: str | None = Query(default=None, max_length=512),
) -> ConversationListResponse:
    page = service.list(identity.user_id, limit=limit, cursor=cursor)
    return ConversationListResponse.from_page(page)


@router.post(
    "",
    response_model=ConversationResponse,
    status_code=201,
    dependencies=[Depends(require_origin), Depends(require_csrf)],
)
def create_conversation(
    body: Annotated[
        ConversationCreateRequest,
        Body(
            openapi_examples={
                "new_conversation": {
                    "summary": "Create an empty conversation",
                    "value": {"client_request_id": "conversation-001", "title": "新对话"},
                }
            }
        ),
    ],
    identity: Annotated[SessionIdentity, Depends(get_identity)],
    service: Annotated[ConversationService, Depends(get_service)],
) -> ConversationResponse:
    view = service.create(
        identity.user_id,
        CreateConversation(client_request_id=body.client_request_id, title=body.title),
    )
    return ConversationResponse.from_view(view)


@router.get("/{conversation_id}", response_model=ConversationDetailResponse)
def get_conversation(
    conversation_id: str,
    identity: Annotated[SessionIdentity, Depends(get_identity)],
    service: Annotated[ConversationService, Depends(get_service)],
    limit: int = Query(default=50, ge=1, le=100),
    cursor: str | None = Query(default=None, max_length=512),
) -> ConversationDetailResponse:
    view = service.get(identity.user_id, conversation_id, limit=limit, cursor=cursor)
    return ConversationDetailResponse.from_view(view)


@router.patch(
    "/{conversation_id}",
    response_model=ConversationResponse,
    dependencies=[Depends(require_origin), Depends(require_csrf)],
)
def update_conversation_title(
    conversation_id: str,
    body: ConversationTitleRequest,
    identity: Annotated[SessionIdentity, Depends(get_identity)],
    service: Annotated[ConversationService, Depends(get_service)],
) -> ConversationResponse:
    view = service.update_title(
        identity.user_id,
        conversation_id,
        UpdateConversationTitle(title=body.title),
    )
    return ConversationResponse.from_view(view)


@router.delete(
    "/{conversation_id}",
    status_code=204,
    dependencies=[Depends(require_origin), Depends(require_csrf)],
)
def delete_conversation(
    conversation_id: str,
    identity: Annotated[SessionIdentity, Depends(get_identity)],
    service: Annotated[ConversationService, Depends(get_service)],
) -> Response:
    service.delete(identity.user_id, conversation_id)
    return Response(status_code=204)
