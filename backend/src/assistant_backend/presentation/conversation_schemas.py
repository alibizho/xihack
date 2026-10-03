from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from assistant_backend.application.conversation_dto import (
    ConversationDetailView,
    ConversationListPage,
    ConversationView,
    MessageView,
)
from assistant_backend.domain.conversations import clean_conversation_title


class ConversationCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    client_request_id: str = Field(min_length=1, max_length=128)
    title: str = Field(default="新对话", max_length=200)

    @field_validator("title")
    @classmethod
    def validate_title(cls, value: str) -> str:
        return clean_conversation_title(value)


class ConversationTitleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(max_length=200)

    @field_validator("title")
    @classmethod
    def validate_title(cls, value: str) -> str:
        return clean_conversation_title(value)


class MessageResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message_id: str
    role: Literal["user", "assistant"]
    content: str
    created_at: datetime

    @classmethod
    def from_view(cls, view: MessageView) -> "MessageResponse":
        return cls(**view.__dict__)


class ConversationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    conversation_id: str
    title: str
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_view(cls, view: ConversationView) -> "ConversationResponse":
        return cls(**view.__dict__)


class ConversationListItemResponse(ConversationResponse):
    last_message_excerpt: str | None = None


class ConversationListResponse(BaseModel):
    items: list[ConversationListItemResponse]
    next_cursor: str | None = None

    @classmethod
    def from_page(cls, page: ConversationListPage) -> "ConversationListResponse":
        return cls(
            items=[ConversationListItemResponse(**item.__dict__) for item in page.items],
            next_cursor=page.next_cursor,
        )


class ConversationDetailResponse(ConversationResponse):
    messages: list[MessageResponse]
    next_cursor: str | None = None

    @classmethod
    def from_view(cls, view: ConversationDetailView) -> "ConversationDetailResponse":
        return cls(
            conversation_id=view.conversation_id,
            title=view.title,
            created_at=view.created_at,
            updated_at=view.updated_at,
            messages=[MessageResponse.from_view(message) for message in view.messages],
            next_cursor=view.next_cursor,
        )
