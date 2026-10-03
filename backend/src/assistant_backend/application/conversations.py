import base64
import hashlib
import json
from dataclasses import asdict
from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from assistant_backend.application.conversation_dto import (
    ConversationDetailView,
    ConversationListItemView,
    ConversationListPage,
    ConversationView,
    CreateConversation,
    MessageView,
    UpdateConversationTitle,
)
from assistant_backend.domain.conversations import clean_conversation_title
from assistant_backend.infrastructure.models import Conversation, Message


class ConversationFailure(Exception):
    def __init__(self, code: str, status: int, message: str) -> None:
        self.code = code
        self.status = status
        self.message = message


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _fingerprint(body: CreateConversation) -> str:
    encoded = json.dumps(asdict(body), ensure_ascii=False, sort_keys=True).encode()
    return hashlib.sha256(encoded).hexdigest()


def _conversation_response(conversation: Conversation) -> ConversationView:
    return ConversationView(
        conversation_id=conversation.conversation_id,
        title=conversation.title,
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
    )


def _encode_cursor(moment: datetime, object_id: str) -> str:
    raw = json.dumps([moment.isoformat(), object_id]).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _decode_cursor(cursor: str) -> tuple[datetime, str]:
    try:
        moment, object_id = json.loads(base64.urlsafe_b64decode(cursor + "=="))
        parsed = datetime.fromisoformat(moment)
        if parsed.tzinfo is None or not isinstance(object_id, str) or not object_id:
            raise ValueError("Invalid cursor values")
        return parsed, object_id
    except (ValueError, TypeError, UnicodeDecodeError) as exc:
        raise ConversationFailure("INVALID_REQUEST", 422, "Invalid cursor") from exc


class ConversationService:
    def __init__(self, factory: sessionmaker[Session]) -> None:
        self.factory = factory

    def create(self, user_id: str, body: CreateConversation) -> ConversationView:
        try:
            title = clean_conversation_title(body.title)
        except ValueError as exc:
            raise ConversationFailure("INVALID_REQUEST", 422, str(exc)) from exc
        fingerprint = _fingerprint(body)
        now = _now()
        conversation = Conversation(
            conversation_id=str(uuid4()),
            user_id=user_id,
            client_request_id=body.client_request_id,
            request_fingerprint=fingerprint,
            title=title,
            created_at=now,
            updated_at=now,
        )
        try:
            with self.factory.begin() as session:
                session.add(conversation)
                session.flush()
        except IntegrityError:
            with self.factory() as session:
                existing = session.scalar(
                    select(Conversation).where(
                        Conversation.user_id == user_id,
                        Conversation.client_request_id == body.client_request_id,
                    )
                )
                if existing is None:
                    raise
                if existing.request_fingerprint != fingerprint:
                    raise ConversationFailure(
                        "IDEMPOTENCY_CONFLICT", 409, "Request key reused"
                    ) from None
                return _conversation_response(existing)
        return _conversation_response(conversation)

    def list(
        self, user_id: str, *, limit: int = 20, cursor: str | None = None
    ) -> ConversationListPage:
        last_message_excerpt = (
            select(func.left(Message.content, 160))
            .where(Message.conversation_id == Conversation.conversation_id)
            .order_by(Message.created_at.desc(), Message.message_id.desc())
            .limit(1)
            .scalar_subquery()
        )
        statement = select(Conversation, last_message_excerpt).where(
            Conversation.user_id == user_id
        )
        if cursor:
            moment, conversation_id = _decode_cursor(cursor)
            statement = statement.where(
                or_(
                    Conversation.created_at < moment,
                    and_(
                        Conversation.created_at == moment,
                        Conversation.conversation_id < conversation_id,
                    ),
                )
            )
        statement = statement.order_by(
            Conversation.created_at.desc(), Conversation.conversation_id.desc()
        ).limit(limit + 1)
        with self.factory() as session:
            rows = list(session.execute(statement))
            items = [
                ConversationListItemView(
                    conversation_id=conversation.conversation_id,
                    title=conversation.title,
                    created_at=conversation.created_at,
                    updated_at=conversation.updated_at,
                    last_message_excerpt=excerpt,
                )
                for conversation, excerpt in rows[:limit]
            ]
            next_cursor = None
            if len(rows) > limit:
                last = rows[limit - 1][0]
                next_cursor = _encode_cursor(last.created_at, last.conversation_id)
            return ConversationListPage(items=items, next_cursor=next_cursor)

    def get(
        self,
        user_id: str,
        conversation_id: str,
        *,
        limit: int = 50,
        cursor: str | None = None,
    ) -> ConversationDetailView:
        with self.factory() as session:
            conversation = session.scalar(
                select(Conversation).where(
                    Conversation.user_id == user_id,
                    Conversation.conversation_id == conversation_id,
                )
            )
            if conversation is None:
                raise ConversationFailure("NOT_FOUND", 404, "Conversation not found")

            statement = select(Message).where(Message.conversation_id == conversation_id)
            if cursor:
                moment, message_id = _decode_cursor(cursor)
                statement = statement.where(
                    or_(
                        Message.created_at > moment,
                        and_(Message.created_at == moment, Message.message_id > message_id),
                    )
                )
            statement = statement.order_by(Message.created_at, Message.message_id).limit(limit + 1)
            messages = list(session.scalars(statement))
            next_cursor = None
            if len(messages) > limit:
                last = messages[limit - 1]
                next_cursor = _encode_cursor(last.created_at, last.message_id)
            return ConversationDetailView(
                conversation_id=conversation.conversation_id,
                title=conversation.title,
                created_at=conversation.created_at,
                updated_at=conversation.updated_at,
                messages=[
                    MessageView(
                        message_id=message.message_id,
                        role=message.role,
                        content=message.content,
                        created_at=message.created_at,
                    )
                    for message in messages[:limit]
                ],
                next_cursor=next_cursor,
            )

    def update_title(
        self, user_id: str, conversation_id: str, body: UpdateConversationTitle
    ) -> ConversationView:
        try:
            title = clean_conversation_title(body.title)
        except ValueError as exc:
            raise ConversationFailure("INVALID_REQUEST", 422, str(exc)) from exc
        with self.factory.begin() as session:
            conversation = session.scalar(
                select(Conversation)
                .where(
                    Conversation.user_id == user_id,
                    Conversation.conversation_id == conversation_id,
                )
                .with_for_update()
            )
            if conversation is None:
                raise ConversationFailure("NOT_FOUND", 404, "Conversation not found")
            if conversation.title != title:
                conversation.title = title
                conversation.updated_at = _now()
            session.flush()
            return _conversation_response(conversation)

    def delete(self, user_id: str, conversation_id: str) -> None:
        with self.factory.begin() as session:
            result = session.execute(
                delete(Conversation).where(
                    Conversation.user_id == user_id,
                    Conversation.conversation_id == conversation_id,
                )
            )
            if result.rowcount == 0:
                raise ConversationFailure("NOT_FOUND", 404, "Conversation not found")
