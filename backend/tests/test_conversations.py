import os
import threading
import time
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from assistant_backend.config import Settings
from assistant_backend.main import create_app


DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
ORIGIN = "https://test.example"
PASSWORD = "a long test passphrase 123"


@pytest.fixture
def client() -> Iterator[TestClient]:
    if DATABASE_URL is None:
        pytest.skip("TEST_DATABASE_URL is required")
    if not (make_url(DATABASE_URL).database or "").endswith("_test"):
        pytest.fail("TEST_DATABASE_URL must point to a dedicated *_test database")
    engine = create_engine(DATABASE_URL)
    with engine.begin() as connection:
        connection.execute(
            text(
                "TRUNCATE conversations, proposals, tasks, auth_rate_limits, sessions, users CASCADE"
            )
        )
    engine.dispose()
    settings = Settings(
        _env_file=None,
        database_url=DATABASE_URL,
        app_origin=ORIGIN,
        csrf_secret="test-secret-with-at-least-32-characters",
    )
    with TestClient(create_app(settings), base_url=ORIGIN) as test_client:
        yield test_client


def register(client: TestClient, username: str) -> None:
    response = client.post(
        "/api/auth/register",
        json={"username": username, "password": PASSWORD, "adult_declared": True},
        headers={"Origin": ORIGIN},
    )
    assert response.status_code == 201, response.text


def write_headers(client: TestClient) -> dict[str, str]:
    return {
        "Origin": ORIGIN,
        "X-CSRF-Token": client.get("/api/auth/csrf").json()["csrf_token"],
    }


def create_conversation(client: TestClient, request_id: str, title: str = "新对话") -> dict:
    response = client.post(
        "/api/conversations",
        json={"client_request_id": request_id, "title": title},
        headers=write_headers(client),
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_conversation_create_list_title_and_idempotency(client: TestClient) -> None:
    register(client, "first_user")
    created = create_conversation(client, "create-1", "  Project  ")
    assert created["title"] == "Project"
    assert (
        create_conversation(client, "create-1", "Project")["conversation_id"]
        == created["conversation_id"]
    )
    conflict = client.post(
        "/api/conversations",
        json={"client_request_id": "create-1", "title": "Different"},
        headers=write_headers(client),
    )
    assert conflict.status_code == 409
    assert conflict.json()["code"] == "IDEMPOTENCY_CONFLICT"

    second = create_conversation(client, "create-2", "Second")
    first_page = client.get("/api/conversations", params={"limit": 1}).json()
    next_page = client.get(
        "/api/conversations",
        params={"limit": 1, "cursor": first_page["next_cursor"]},
    ).json()
    assert {item["conversation_id"] for item in first_page["items"] + next_page["items"]} == {
        created["conversation_id"],
        second["conversation_id"],
    }
    assert client.get("/api/conversations", params={"cursor": "%%%"}).status_code == 422

    updated = client.patch(
        f"/api/conversations/{created['conversation_id']}",
        json={"title": "Renamed"},
        headers=write_headers(client),
    )
    assert updated.status_code == 200
    assert updated.json()["title"] == "Renamed"
    assert "user_id" not in updated.json()
    with TestClient(client.app, base_url=ORIGIN) as second_device:
        login = second_device.post(
            "/api/auth/login",
            json={"username": "first_user", "password": PASSWORD},
            headers={"Origin": ORIGIN},
        )
        assert login.status_code == 200
        assert second_device.get("/api/conversations").json()["items"]


def test_history_pagination_account_isolation_and_delete_preserves_tasks(
    client: TestClient,
) -> None:
    register(client, "first_user")
    conversation = create_conversation(client, "history-1")
    assert (
        client.get(f"/api/conversations/{conversation['conversation_id']}").json()["messages"] == []
    )

    assert DATABASE_URL is not None
    engine = create_engine(DATABASE_URL)
    timestamp = datetime(2026, 10, 2, tzinfo=timezone.utc)
    with engine.begin() as connection:
        user_id = connection.scalar(
            text("SELECT user_id FROM users WHERE username_normalized = 'first_user'")
        )
        connection.execute(
            text(
                "INSERT INTO tasks (task_id, user_id, title, importance, urgency, status, version, "
                "created_at, updated_at) VALUES ('task-kept', :user_id, 'Keep me', 4.0, 3.0, "
                "'open', 1, :created_at, :updated_at)"
            ),
            {"user_id": user_id, "created_at": timestamp, "updated_at": timestamp},
        )
        for message_id, content in (
            ("message-a", "first"),
            ("message-b", "second"),
            ("message-c", "third"),
        ):
            connection.execute(
                text(
                    "INSERT INTO messages (message_id, conversation_id, role, content, created_at) "
                    "VALUES (:message_id, :conversation_id, 'user', :content, :created_at)"
                ),
                {
                    "message_id": message_id,
                    "conversation_id": conversation["conversation_id"],
                    "content": content,
                    "created_at": timestamp,
                },
            )
    engine.dispose()

    page = client.get(
        f"/api/conversations/{conversation['conversation_id']}", params={"limit": 2}
    ).json()
    next_page = client.get(
        f"/api/conversations/{conversation['conversation_id']}",
        params={"limit": 2, "cursor": page["next_cursor"]},
    ).json()
    assert [message["content"] for message in page["messages"] + next_page["messages"]] == [
        "first",
        "second",
        "third",
    ]
    assert client.get("/api/conversations").json()["items"][0]["last_message_excerpt"] == "third"

    with TestClient(client.app, base_url=ORIGIN) as other:
        register(other, "other_user")
        hidden = other.get(f"/api/conversations/{conversation['conversation_id']}")
        assert hidden.status_code == 404
        assert other.get("/api/conversations").json()["items"] == []
        assert (
            other.delete(
                f"/api/conversations/{conversation['conversation_id']}",
                headers=write_headers(other),
            ).status_code
            == 404
        )
        assert (
            other.patch(
                f"/api/conversations/{conversation['conversation_id']}",
                json={"title": "stolen"},
                headers=write_headers(other),
            ).status_code
            == 404
        )

    deleted = client.delete(
        f"/api/conversations/{conversation['conversation_id']}", headers=write_headers(client)
    )
    assert deleted.status_code == 204
    assert (
        client.delete(
            f"/api/conversations/{conversation['conversation_id']}", headers=write_headers(client)
        ).status_code
        == 404
    )
    engine = create_engine(DATABASE_URL)
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT count(*) FROM messages")) == 0
        assert (
            connection.scalar(text("SELECT count(*) FROM tasks WHERE task_id = 'task-kept'")) == 1
        )
    engine.dispose()


def test_delete_racing_message_insert_cannot_leave_orphan_or_resurrect_history(
    client: TestClient,
) -> None:
    register(client, "race_user")
    conversation = create_conversation(client, "race-1")
    assert DATABASE_URL is not None
    engine = create_engine(DATABASE_URL)
    with engine.connect() as connection:
        user_id = connection.scalar(
            text("SELECT user_id FROM users WHERE username_normalized = 'race_user'")
        )
    engine.dispose()
    assert user_id is not None
    engine = create_engine(DATABASE_URL, pool_size=3)
    inserted = threading.Event()
    allow_commit = threading.Event()
    delete_started = threading.Event()

    def insert_message() -> None:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO messages (message_id, conversation_id, role, content, created_at) "
                    "VALUES ('race-message', :conversation_id, 'user', 'concurrent', now())"
                ),
                {"conversation_id": conversation["conversation_id"]},
            )
            inserted.set()
            assert allow_commit.wait(timeout=5)

    def delete_conversation() -> None:
        delete_started.set()
        client.app.state.conversation_service.delete(user_id, conversation["conversation_id"])

    with ThreadPoolExecutor(max_workers=2) as executor:
        writer = executor.submit(insert_message)
        assert inserted.wait(timeout=5)
        deleter = executor.submit(delete_conversation)
        assert delete_started.wait(timeout=5)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            with engine.connect() as connection:
                blocked_delete = connection.scalar(
                    text(
                        "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' "
                        "AND query ILIKE 'DELETE FROM conversations%'"
                    )
                )
            if blocked_delete:
                break
            time.sleep(0.01)
        assert blocked_delete, (
            "conversation deletion did not wait for the uncommitted message insert"
        )
        allow_commit.set()
        writer.result(timeout=5)
        deleter.result(timeout=5)

    with engine.connect() as connection:
        assert (
            connection.scalar(
                text("SELECT count(*) FROM conversations WHERE conversation_id = :conversation_id"),
                {"conversation_id": conversation["conversation_id"]},
            )
            == 0
        )
        assert (
            connection.scalar(
                text("SELECT count(*) FROM messages WHERE message_id = 'race-message'")
            )
            == 0
        )
    engine.dispose()
