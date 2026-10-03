from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class CreateConversation:
    client_request_id: str
    title: str


@dataclass(frozen=True)
class UpdateConversationTitle:
    title: str


@dataclass(frozen=True)
class MessageView:
    message_id: str
    role: str
    content: str
    created_at: datetime


@dataclass(frozen=True)
class ConversationView:
    conversation_id: str
    title: str
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class ConversationListItemView(ConversationView):
    last_message_excerpt: str | None


@dataclass(frozen=True)
class ConversationListPage:
    items: list[ConversationListItemView]
    next_cursor: str | None


@dataclass(frozen=True)
class ConversationDetailView(ConversationView):
    messages: list[MessageView]
    next_cursor: str | None
