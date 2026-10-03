import os
import json
from collections.abc import Iterator
from datetime import datetime, timedelta, timezone
from threading import Barrier, Event
from uuid import uuid4
from unittest.mock import patch
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, text
from sqlalchemy.engine import make_url

from assistant_backend.config import Settings
from assistant_backend.agent.provider import ChatDelta, ProviderFailure, ToolCallDelta
from assistant_backend.agent.runtime import AgentRuntime
from assistant_backend.agent.tools import ProposalTaskTools, ReadOnlyTaskTools
from assistant_backend.application.reports import ReportInsight
from assistant_backend.infrastructure.models import AgentRun, Message, Proposal, RunEvent, User
from assistant_backend.main import create_app
from assistant_backend.presentation.agent import _event_stream


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
            text("TRUNCATE proposals, tasks, auth_rate_limits, sessions, users CASCADE")
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


def propose(client: TestClient, body: dict) -> dict:
    response = client.post("/api/proposals", json=body, headers=write_headers(client))
    assert response.status_code == 201, response.text
    return response.json()


def confirm(client: TestClient, proposal_id: str, key: str = "confirm-1") -> dict:
    response = client.post(
        f"/api/proposals/{proposal_id}/confirm",
        json={"idempotency_key": key},
        headers=write_headers(client),
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_create_requires_confirmation_and_retries_are_idempotent(client: TestClient) -> None:
    register(client, "first_user")
    for score in (True, 10.1, 5.25):
        invalid = client.post(
            "/api/proposals",
            json={
                "client_request_id": f"invalid-score-{score}",
                "operation": "create",
                "task": {"title": "Bad score", "importance": score},
            },
            headers=write_headers(client),
        )
        assert invalid.status_code == 422
    body = {
        "client_request_id": "request-1",
        "operation": "create",
        "task": {
            "title": "  Plan work  ",
            "importance": 8.0,
            "due": {"precision": "date", "date": "2026-10-09", "timezone": "Asia/Shanghai"},
        },
    }
    assert client.get("/api/tasks").json()["items"] == []
    assert client.post("/api/proposals", json=body, headers={"Origin": ORIGIN}).status_code == 403
    proposal = propose(client, body)
    assert client.get("/api/tasks").json()["items"] == []
    assert propose(client, body)["proposal_id"] == proposal["proposal_id"]
    changed = {**body, "task": {"title": "Different"}}
    assert (
        client.post("/api/proposals", json=changed, headers=write_headers(client)).status_code
        == 409
    )
    receipt = confirm(client, proposal["proposal_id"])
    assert confirm(client, proposal["proposal_id"]) == receipt
    assert (
        client.post(
            f"/api/proposals/{proposal['proposal_id']}/confirm",
            json={"idempotency_key": "different"},
            headers=write_headers(client),
        ).status_code
        == 409
    )
    task = receipt["task"]
    assert task["title"] == "Plan work"
    assert task["importance"] == 8.0
    assert task["urgency"] == 3.0
    assert task["due"]["precision"] == "date"
    assert task["version"] == 1
    assert client.get("/api/tasks").json()["items"] == [task]
    with TestClient(client.app, base_url=ORIGIN) as second_device:
        login = second_device.post(
            "/api/auth/login",
            json={"username": "first_user", "password": PASSWORD},
            headers={"Origin": ORIGIN},
        )
        assert login.status_code == 200
        assert second_device.get(f"/api/tasks/{task['task_id']}").json() == task
        updated = propose(
            second_device,
            {
                "client_request_id": "other-device-update",
                "operation": "update",
                "task_id": task["task_id"],
                "expected_version": 1,
                "changes": {"urgency": 8.0},
            },
        )
        confirm(second_device, updated["proposal_id"], "other-device-key")
    assert client.get(f"/api/tasks/{task['task_id']}").json()["urgency"] == 8.0


def test_cross_account_version_conflict_and_delete_invalidation(client: TestClient) -> None:
    register(client, "first_user")
    created = confirm(
        client,
        propose(
            client,
            {
                "client_request_id": "create",
                "operation": "create",
                "task": {"title": "Original"},
            },
        )["proposal_id"],
    )["task"]
    task_id = created["task_id"]
    with TestClient(client.app, base_url=ORIGIN) as other:
        register(other, "other_user")
        assert other.get(f"/api/tasks/{task_id}").status_code == 404
        assert other.get("/api/tasks").json()["items"] == []
        assert (
            other.post(
                "/api/proposals",
                json={
                    "client_request_id": "cross",
                    "operation": "delete",
                    "task_id": task_id,
                    "expected_version": 1,
                },
                headers=write_headers(other),
            ).status_code
            == 404
        )
    stale = propose(
        client,
        {
            "client_request_id": "stale",
            "operation": "update",
            "task_id": task_id,
            "expected_version": 1,
            "changes": {"title": "Stale"},
        },
    )
    update = propose(
        client,
        {
            "client_request_id": "update",
            "operation": "update",
            "task_id": task_id,
            "expected_version": 1,
            "changes": {"description": "Changed"},
        },
    )
    assert confirm(client, update["proposal_id"], "update-key")["task"]["version"] == 2
    assert (
        client.post(
            f"/api/proposals/{stale['proposal_id']}/confirm",
            json={"idempotency_key": "stale-key"},
            headers=write_headers(client),
        ).json()["code"]
        == "VERSION_CONFLICT"
    )
    assert client.get(f"/api/tasks/{task_id}").json()["title"] == "Original"
    delete = propose(
        client,
        {
            "client_request_id": "delete",
            "operation": "delete",
            "task_id": task_id,
            "expected_version": 2,
        },
    )
    assert confirm(client, delete["proposal_id"], "delete-key")["task"] is None
    assert client.get(f"/api/tasks/{task_id}").status_code == 404
    assert client.get(f"/api/proposals/{stale['proposal_id']}").json()["status"] == "invalidated"


def test_expiry_cancel_and_minute_deadline(client: TestClient) -> None:
    register(client, "first_user")
    proposal = propose(
        client,
        {
            "client_request_id": str(uuid4()),
            "operation": "create",
            "task": {
                "title": "Minute due",
                "due": {
                    "precision": "minute",
                    "at": "2026-10-09T15:30:00+08:00",
                    "timezone": "Asia/Shanghai",
                },
            },
        },
    )
    assert DATABASE_URL is not None
    engine = create_engine(DATABASE_URL)
    with engine.begin() as connection:
        connection.execute(
            text("UPDATE proposals SET expires_at = :past WHERE proposal_id = :id"),
            {
                "past": datetime.now(timezone.utc) - timedelta(seconds=1),
                "id": proposal["proposal_id"],
            },
        )
    engine.dispose()
    expired = client.post(
        f"/api/proposals/{proposal['proposal_id']}/confirm",
        json={"idempotency_key": "expired"},
        headers=write_headers(client),
    )
    assert expired.status_code == 409
    assert expired.json()["code"] == "PROPOSAL_EXPIRED"
    assert client.get("/api/tasks").json()["items"] == []
    cancelled = client.post(
        f"/api/proposals/{proposal['proposal_id']}/cancel",
        headers=write_headers(client),
    )
    assert cancelled.status_code == 204
    assert (
        client.post(
            f"/api/proposals/{proposal['proposal_id']}/cancel",
            headers=write_headers(client),
        ).status_code
        == 204
    )


def test_failed_confirmation_rolls_back_and_filter_pagination(client: TestClient) -> None:
    register(client, "first_user")
    first = propose(
        client,
        {
            "client_request_id": "first",
            "operation": "create",
            "task": {"title": "First", "importance": 8.0},
        },
    )
    with TestClient(client.app, base_url=ORIGIN, raise_server_exceptions=False) as failing:
        failing.cookies.update(client.cookies)
        with patch(
            "assistant_backend.application.tasks._task_response",
            side_effect=RuntimeError("private"),
        ):
            result = failing.post(
                f"/api/proposals/{first['proposal_id']}/confirm",
                json={"idempotency_key": "first-key"},
                headers=write_headers(failing),
            )
    assert result.status_code == 500
    assert client.get("/api/tasks").json()["items"] == []
    assert client.get(f"/api/proposals/{first['proposal_id']}").json()["status"] == "pending"
    first_task = confirm(client, first["proposal_id"], "first-key")["task"]
    second = propose(
        client,
        {
            "client_request_id": "second",
            "operation": "create",
            "task": {"title": "Second", "importance": 4.0},
        },
    )
    second_task = confirm(client, second["proposal_id"], "second-key")["task"]
    page = client.get("/api/tasks", params={"limit": 1}).json()
    assert len(page["items"]) == 1
    assert page["next_cursor"]
    following = client.get("/api/tasks", params={"limit": 1, "cursor": page["next_cursor"]}).json()
    assert {page["items"][0]["task_id"], following["items"][0]["task_id"]} == {
        first_task["task_id"],
        second_task["task_id"],
    }
    assert [
        item["task_id"]
        for item in client.get("/api/tasks", params={"important": True}).json()["items"]
    ] == [first_task["task_id"]]
    invalid_cursor = client.get("/api/tasks", params={"cursor": "%%%"})
    assert invalid_cursor.status_code == 422
    assert invalid_cursor.json()["code"] == "INVALID_REQUEST"
    complete = propose(
        client,
        {
            "client_request_id": "complete",
            "operation": "complete",
            "task_id": first_task["task_id"],
            "expected_version": 1,
        },
    )
    completed = confirm(client, complete["proposal_id"], "complete-key")["task"]
    assert completed["status"] == "completed"
    assert completed["version"] == 2


def create_conversation(client: TestClient, request_id: str = "conversation-one") -> dict:
    response = client.post(
        "/api/conversations",
        json={"client_request_id": request_id, "title": "Agent test"},
        headers=write_headers(client),
    )
    assert response.status_code == 201, response.text
    return response.json()


def submit_message(client: TestClient, conversation_id: str, request_id: str, content: str) -> dict:
    response = client.post(
        f"/api/conversations/{conversation_id}/messages",
        json={"client_message_id": request_id, "content": content},
        headers=write_headers(client),
    )
    return response.json() if response.status_code == 202 else {"response": response}


def current_user_id(client: TestClient) -> str:
    settings = client.app.state.settings
    identity = client.app.state.identity_service.current(
        client.cookies.get(settings.session_cookie_name)
    )
    return identity.user_id


def test_agent_message_submit_is_atomic_idempotent_and_account_scoped(
    client: TestClient,
) -> None:
    register(client, "first_user")
    conversation = create_conversation(client)
    path = f"/api/conversations/{conversation['conversation_id']}/messages"
    body = {"client_message_id": "message-1", "content": "List my tasks"}
    accepted = client.post(path, json=body, headers=write_headers(client))
    assert accepted.status_code == 202
    replayed = client.post(path, json=body, headers=write_headers(client))
    assert replayed.status_code == 202
    assert replayed.json()["run_id"] == accepted.json()["run_id"]
    assert replayed.json()["replayed"] is True
    conflict = client.post(
        path,
        json={"client_message_id": "message-1", "content": "Different content"},
        headers=write_headers(client),
    )
    assert conflict.status_code == 409
    assert conflict.json()["code"] == "IDEMPOTENCY_CONFLICT"
    stored_messages = client.get(f"/api/conversations/{conversation['conversation_id']}").json()[
        "messages"
    ]
    assert len(stored_messages) == 1
    assert stored_messages[0]["role"] == "user"
    assert stored_messages[0]["content"] == "List my tasks"
    register(client, "second_user")
    assert client.get(f"/api/runs/{accepted.json()['run_id']}").status_code == 404
    assert client.get(f"/api/runs/{accepted.json()['run_id']}/events").status_code == 404


def test_concurrent_duplicate_message_submission_creates_one_run(client: TestClient) -> None:
    register(client, "first_user")
    conversation = create_conversation(client)
    user_id = current_user_id(client)
    service = client.app.state.agent_run_service
    barrier = Barrier(2)

    def submit() -> str:
        barrier.wait(timeout=3)
        return service.submit_message(
            user_id,
            "127.0.0.1",
            conversation["conversation_id"],
            "same-message-id",
            "Same content",
        ).run_id

    with ThreadPoolExecutor(max_workers=2) as executor:
        run_ids = list(executor.map(lambda _: submit(), range(2)))
    assert run_ids[0] == run_ids[1]
    assert DATABASE_URL is not None
    engine = create_engine(DATABASE_URL)
    with engine.connect() as connection:
        assert (
            connection.scalar(
                text("SELECT count(*) FROM agent_runs WHERE client_message_id = 'same-message-id'")
            )
            == 1
        )
        assert (
            connection.scalar(
                text("SELECT count(*) FROM messages WHERE conversation_id = :conversation_id"),
                {"conversation_id": conversation["conversation_id"]},
            )
            == 1
        )
    engine.dispose()


class ToolThenAnswerProvider:
    def __init__(self, task_id: str) -> None:
        self.task_id = task_id
        self.calls = 0

    def stream_chat(self, messages: list[dict], tools: list[dict], max_output_tokens: int):
        del tools, max_output_tokens
        self.calls += 1
        if self.calls == 1:
            yield ChatDelta(
                tool_calls=[
                    ToolCallDelta(
                        index=0,
                        call_id="tool-call-1",
                        name="get_task",
                        arguments=f'{{"task_id":"{self.task_id}"}}',
                    )
                ],
                input_tokens=20,
                output_tokens=12,
            )
            return
        assert any(message["role"] == "tool" for message in messages)
        yield ChatDelta(content="Your task is due soon.", input_tokens=30, output_tokens=7)


def test_agent_worker_runs_read_only_tool_and_sse_replays_persisted_events(
    client: TestClient,
) -> None:
    register(client, "first_user")
    proposal = propose(
        client,
        {
            "client_request_id": "task-for-agent",
            "operation": "create",
            "task": {"title": "Prepare demo", "importance": 8.0},
        },
    )
    task = confirm(client, proposal["proposal_id"])["task"]
    conversation = create_conversation(client)
    accepted = client.post(
        f"/api/conversations/{conversation['conversation_id']}/messages",
        json={"client_message_id": "question-1", "content": "When is Prepare demo?"},
        headers=write_headers(client),
    ).json()
    settings = client.app.state.settings
    runs = client.app.state.agent_run_service
    worker_id = "worker-test"
    assert runs.claim_next(worker_id) == accepted["run_id"]
    provider = ToolThenAnswerProvider(task["task_id"])
    AgentRuntime(runs, client.app.state.task_service, provider, settings).execute(
        accepted["run_id"], worker_id
    )
    status = client.get(f"/api/runs/{accepted['run_id']}").json()
    assert status["status"] == "completed"
    assert status["assistant_content"] == "Your task is due soon."
    assert provider.calls == 2
    stream = client.get(
        f"/api/runs/{accepted['run_id']}/events",
        headers={"Last-Event-ID": "0"},
    )
    assert stream.status_code == 200
    assert stream.headers["content-type"].startswith("text/event-stream")
    assert "event: run.started" in stream.text
    assert "event: message.delta" in stream.text
    assert "event: run.completed" in stream.text
    assert "reasoning" not in stream.text.lower()
    resumed = client.get(
        f"/api/runs/{accepted['run_id']}/events",
        headers={"Last-Event-ID": str(status["last_event_sequence"] - 2)},
    )
    assert "event: message.delta" in resumed.text
    assert "event: run.completed" in resumed.text
    assert "event: run.started" not in resumed.text
    assert provider.calls == 2
    messages = client.get(f"/api/conversations/{conversation['conversation_id']}").json()[
        "messages"
    ]
    assert [message["role"] for message in messages] == ["user", "assistant"]
    own_tool_result = ReadOnlyTaskTools(
        client.app.state.task_service, current_user_id(client)
    ).invoke("get_task", f'{{"task_id":"{task["task_id"]}"}}')
    assert task["task_id"] in own_tool_result
    engine = create_engine(DATABASE_URL)
    with engine.begin() as connection:
        connection.execute(
            text("UPDATE run_events SET created_at = :old WHERE run_id = :run_id"),
            {
                "old": datetime.now(timezone.utc) - timedelta(days=8),
                "run_id": accepted["run_id"],
            },
        )
    engine.dispose()
    expired_stream = client.get(
        f"/api/runs/{accepted['run_id']}/events",
        headers={"Last-Event-ID": "0"},
    )
    assert "event: run.snapshot" in expired_stream.text
    assert "Your task is due soon." in expired_stream.text
    register(client, "second_user")
    foreign_tool_result = ReadOnlyTaskTools(
        client.app.state.task_service, current_user_id(client)
    ).invoke("get_task", f'{{"task_id":"{task["task_id"]}"}}')
    assert foreign_tool_result == '{"error": "not_found"}'


def test_agent_proposal_tool_requires_confirmation_before_task_write(client: TestClient) -> None:
    register(client, "first_user")
    conversation = create_conversation(client, "proposal-conversation")
    accepted = client.post(
        f"/api/conversations/{conversation['conversation_id']}/messages",
        json={
            "client_message_id": "proposal-question",
            "content": "[应用提供的用户本地时间：2026-10-03 10:00；时区：Asia/Shanghai]\n明天得交数学作业，晚上还要给妈妈打电话。数学题需要再检查半小时。",
        },
        headers=write_headers(client),
    ).json()
    runs = client.app.state.agent_run_service
    worker_id = "worker-proposal"
    assert runs.claim_next(worker_id) == accepted["run_id"]

    class ProposalProvider:
        def __init__(self) -> None:
            self.calls = 0

        def stream_chat(self, messages: list[dict], tools: list[dict], max_output_tokens: int):
            del max_output_tokens
            self.calls += 1
            if self.calls == 1:
                assert any(tool["function"]["name"] == "propose_create_task" for tool in tools)
                yield ChatDelta(
                    tool_calls=[
                        ToolCallDelta(
                            index=0,
                            call_id="proposal-call-1",
                            name="propose_create_task",
                            arguments=json.dumps(
                                {
                                    "task": {
                                        "title": "交数学作业",
                                        "description": "检查数学题约半小时",
                                        "category": "学习",
                                        "due": {
                                            "precision": "date",
                                            "date": "2026-10-04",
                                            "timezone": "Asia/Shanghai",
                                        },
                                        "importance": 8.5,
                                        "urgency": 9.0,
                                    }
                                }
                            ),
                        ),
                        ToolCallDelta(
                            index=1,
                            call_id="proposal-call-2",
                            name="propose_create_task",
                            arguments=json.dumps(
                                {
                                    "task": {
                                        "title": "给妈妈打电话",
                                        "category": "家庭",
                                        "due": None,
                                        "importance": 7.0,
                                        "urgency": 3.0,
                                    }
                                }
                            ),
                        ),
                    ]
                )
                return
            assert any(message["role"] == "tool" for message in messages)
            yield ChatDelta(content="已整理两项待确认提案，请逐项确认。")

    AgentRuntime(
        runs,
        client.app.state.task_service,
        ProposalProvider(),
        client.app.state.settings,
    ).execute(accepted["run_id"], worker_id)

    assert client.get("/api/tasks").json()["items"] == []
    run_proposals = client.get(f"/api/runs/{accepted['run_id']}/proposals")
    assert run_proposals.status_code == 200
    assert len(run_proposals.json()) == 2
    by_title = {item["task"]["title"]: item for item in run_proposals.json()}
    assert by_title["交数学作业"]["task"] == {
        "title": "交数学作业",
        "description": "检查数学题约半小时",
        "category": "学习",
        "due": {"precision": "date", "date": "2026-10-04", "timezone": "Asia/Shanghai"},
        "importance": 8.5,
        "urgency": 9.0,
    }
    assert by_title["给妈妈打电话"]["task"]["due"] is None
    with client.app.state.agent_run_service.factory() as session:
        proposals = list(
            session.scalars(select(Proposal).where(Proposal.client_request_id.like("agent:%")))
        )
        assert len(proposals) == 2
        assert all(item.source == "agent" and item.status == "pending" for item in proposals)
    proposal_id = by_title["交数学作业"]["proposal_id"]

    confirmed = client.post(
        f"/api/proposals/{proposal_id}/confirm",
        json={"idempotency_key": "agent-confirm"},
        headers=write_headers(client),
    )
    assert confirmed.status_code == 200
    assert client.get("/api/tasks").json()["items"][0]["title"] == "交数学作业"
    assert (
        client.get(f"/api/proposals/{by_title['给妈妈打电话']['proposal_id']}").json()["status"]
        == "pending"
    )
    register(client, "second_user")
    assert client.get(f"/api/runs/{accepted['run_id']}/proposals").status_code == 404


def test_completed_task_report_is_analyzed_and_account_scoped(client: TestClient) -> None:
    register(client, "report_owner")
    task = confirm(
        client,
        propose(
            client,
            {
                "client_request_id": "report-task",
                "operation": "create",
                "task": {"title": "Prepare demo"},
            },
        )["proposal_id"],
    )["task"]
    path = f"/api/tasks/{task['task_id']}/report"
    assert (
        client.post(
            path, json={"body": "I needed more time"}, headers=write_headers(client)
        ).status_code
        == 409
    )
    complete = propose(
        client,
        {
            "client_request_id": "finish-report-task",
            "operation": "complete",
            "task_id": task["task_id"],
            "expected_version": task["version"],
        },
    )
    confirm(client, complete["proposal_id"], "finish-report-key")

    def unavailable(_title: str, _body: str) -> ReportInsight:
        raise RuntimeError("temporary model failure")

    client.app.state.report_service.analyzer = unavailable
    pending = client.post(path, json={"body": "I needed more time"}, headers=write_headers(client))
    assert pending.status_code == 201
    assert pending.json()["status"] == "pending"
    assert client.get(path).json()["body"] == "I needed more time"
    client.app.state.report_service.analyzer = lambda _title, _body: ReportInsight(
        summary="Finished after extra preparation",
        blocker="Time estimate was short",
        next_step="Plan a longer preparation block",
    )
    saved = client.post(path, json={"body": "I needed more time"}, headers=write_headers(client))
    assert saved.status_code == 201, saved.text
    assert saved.json()["report_id"] == pending.json()["report_id"]
    assert saved.json()["status"] == "analyzed"
    assert saved.json()["blocker"] == "Time estimate was short"
    assert client.get(path).json()["report_id"] == saved.json()["report_id"]
    assert (
        client.post(
            path, json={"body": "I needed more time"}, headers=write_headers(client)
        ).json()["report_id"]
        == saved.json()["report_id"]
    )
    assert (
        client.post(path, json={"body": "Different"}, headers=write_headers(client)).status_code
        == 409
    )
    assert "Time estimate was short" in ReadOnlyTaskTools(
        client.app.state.task_service, current_user_id(client)
    ).invoke("search_task_reports", "{}")
    register(client, "report_other")
    assert client.get(path).status_code == 404
    assert (
        client.post(path, json={"body": "Not mine"}, headers=write_headers(client)).status_code
        == 404
    )


def test_agent_proposal_tools_cover_all_task_operations_without_direct_write(
    client: TestClient,
) -> None:
    register(client, "first_user")
    created = confirm(
        client,
        propose(
            client,
            {
                "client_request_id": "seed-agent-tools",
                "operation": "create",
                "task": {"title": "Existing task"},
            },
        )["proposal_id"],
    )["task"]
    tools = ProposalTaskTools(
        client.app.state.task_service,
        current_user_id(client),
        "run-agent-tools",
    )
    calls = (
        (
            "propose_update_task",
            {"task_id": created["task_id"], "expected_version": 1, "changes": {"urgency": 8.0}},
        ),
        (
            "propose_complete_task",
            {"task_id": created["task_id"], "expected_version": 1},
        ),
        (
            "propose_delete_task",
            {"task_id": created["task_id"], "expected_version": 1},
        ),
    )
    for index, (name, arguments) in enumerate(calls):
        result = json.loads(tools.invoke(name, json.dumps(arguments), f"call-{index}"))
        assert result["status"] == "pending"
    assert client.get(f"/api/tasks/{created['task_id']}").json()["version"] == 1
    assert client.get(f"/api/tasks/{created['task_id']}").json()["urgency"] == 3.0


def test_agent_rate_limit_and_worker_lease_recovery(client: TestClient) -> None:
    register(client, "first_user")
    settings = client.app.state.settings
    settings.agent_user_hour_limit = 1
    first_conversation = create_conversation(client, "conversation-one")
    accepted = client.post(
        f"/api/conversations/{first_conversation['conversation_id']}/messages",
        json={"client_message_id": "message-one", "content": "Hello"},
        headers=write_headers(client),
    )
    assert accepted.status_code == 202
    second_conversation = create_conversation(client, "conversation-two")
    limited = client.post(
        f"/api/conversations/{second_conversation['conversation_id']}/messages",
        json={"client_message_id": "message-two", "content": "Hello again"},
        headers=write_headers(client),
    )
    assert limited.status_code == 429
    assert limited.json()["code"] == "RATE_LIMITED"
    runs = client.app.state.agent_run_service
    claimed = runs.claim_next("worker-crashed")
    assert claimed == accepted.json()["run_id"]
    assert runs.claim_next("worker-restart") is None
    assert runs.get(current_user_id(client), claimed).status == "running"
    assert DATABASE_URL is not None
    engine = create_engine(DATABASE_URL)
    with engine.begin() as connection:
        connection.execute(
            text("UPDATE agent_runs SET lease_expires_at = :past WHERE run_id = :id"),
            {"past": datetime.now(timezone.utc) - timedelta(seconds=1), "id": claimed},
        )
    engine.dispose()
    assert runs.claim_next("worker-restart") is None
    assert runs.get(current_user_id(client), claimed).status == "failed"
    assert runs.get(current_user_id(client), claimed).error_code == "WORKER_INTERRUPTED"


def test_model_failure_keeps_user_message_and_has_safe_error_code(client: TestClient) -> None:
    register(client, "first_user")
    conversation = create_conversation(client)
    accepted = client.post(
        f"/api/conversations/{conversation['conversation_id']}/messages",
        json={"client_message_id": "provider-failure", "content": "A safe synthetic prompt"},
        headers=write_headers(client),
    ).json()
    runs = client.app.state.agent_run_service
    worker_id = "worker-provider-failure"
    assert runs.claim_next(worker_id) == accepted["run_id"]

    class FailingProvider:
        def stream_chat(self, messages: list[dict], tools: list[dict], max_output_tokens: int):
            del messages, tools, max_output_tokens
            raise ProviderFailure("MODEL_UNAVAILABLE", True)
            yield ChatDelta()

    AgentRuntime(
        runs,
        client.app.state.task_service,
        FailingProvider(),
        client.app.state.settings,
    ).execute(accepted["run_id"], worker_id)
    status = client.get(f"/api/runs/{accepted['run_id']}").json()
    assert status["status"] == "failed"
    assert status["error_code"] == "MODEL_UNAVAILABLE"
    messages = client.get(f"/api/conversations/{conversation['conversation_id']}").json()[
        "messages"
    ]
    assert len(messages) == 1
    assert messages[0]["content"] == "A safe synthetic prompt"


def test_agent_ip_rate_limit_is_shared_across_accounts(client: TestClient) -> None:
    register(client, "first_user")
    client.app.state.settings.agent_ip_hour_limit = 1
    conversation = create_conversation(client)
    first = client.post(
        f"/api/conversations/{conversation['conversation_id']}/messages",
        json={"client_message_id": "first-message", "content": "Hello"},
        headers=write_headers(client),
    )
    assert first.status_code == 202
    register(client, "second_user")
    second_conversation = create_conversation(client, "second-conversation")
    second = client.post(
        f"/api/conversations/{second_conversation['conversation_id']}/messages",
        json={"client_message_id": "second-message", "content": "Hello"},
        headers=write_headers(client),
    )
    assert second.status_code == 429
    assert second.json()["code"] == "RATE_LIMITED"


def test_agent_concurrency_and_global_request_limits(client: TestClient) -> None:
    register(client, "first_user")
    client.app.state.settings.agent_global_minute_limit = 2
    first = create_conversation(client, "global-one")
    second = create_conversation(client, "global-two")
    for index, conversation in enumerate((first, second)):
        accepted = client.post(
            f"/api/conversations/{conversation['conversation_id']}/messages",
            json={"client_message_id": f"global-message-{index}", "content": "Hello"},
            headers=write_headers(client),
        )
        assert accepted.status_code == 202
    third = create_conversation(client, "global-three")
    concurrency_limited = client.post(
        f"/api/conversations/{third['conversation_id']}/messages",
        json={"client_message_id": "global-message-2", "content": "Hello"},
        headers=write_headers(client),
    )
    assert concurrency_limited.status_code == 429
    assert concurrency_limited.json()["code"] == "RUN_LIMIT_REACHED"
    register(client, "second_user")
    other = create_conversation(client, "global-four")
    global_limited = client.post(
        f"/api/conversations/{other['conversation_id']}/messages",
        json={"client_message_id": "global-message-3", "content": "Hello"},
        headers=write_headers(client),
    )
    assert global_limited.status_code == 429
    assert global_limited.json()["code"] == "RATE_LIMITED"


def test_deleting_conversation_during_model_call_cascades_run_without_losing_tasks(
    client: TestClient,
) -> None:
    register(client, "first_user")
    proposal = propose(
        client,
        {
            "client_request_id": "task-survives-chat",
            "operation": "create",
            "task": {"title": "Keep this task"},
        },
    )
    task = confirm(client, proposal["proposal_id"])["task"]
    conversation = create_conversation(client)
    accepted = client.post(
        f"/api/conversations/{conversation['conversation_id']}/messages",
        json={"client_message_id": "question-delete", "content": "Read my task"},
        headers=write_headers(client),
    ).json()
    runs = client.app.state.agent_run_service
    worker_id = "worker-delete-race"
    assert runs.claim_next(worker_id) == accepted["run_id"]
    provider_started = Event()
    continue_provider = Event()

    class BlockingProvider:
        def stream_chat(self, messages: list[dict], tools: list[dict], max_output_tokens: int):
            del messages, tools, max_output_tokens
            provider_started.set()
            assert continue_provider.wait(timeout=5)
            yield ChatDelta(content="late model answer")

    runtime = AgentRuntime(
        runs,
        client.app.state.task_service,
        BlockingProvider(),
        client.app.state.settings,
    )
    with ThreadPoolExecutor(max_workers=1) as executor:
        result = executor.submit(runtime.execute, accepted["run_id"], worker_id)
        assert provider_started.wait(timeout=3)
        deleted = client.delete(
            f"/api/conversations/{conversation['conversation_id']}",
            headers=write_headers(client),
        )
        assert deleted.status_code == 204
        continue_provider.set()
        result.result(timeout=5)

    assert client.get("/api/tasks").json()["items"][0]["task_id"] == task["task_id"]
    assert list(_event_stream(runs, current_user_id(client), accepted["run_id"], 0)) == []
    assert DATABASE_URL is not None
    engine = create_engine(DATABASE_URL)
    with engine.connect() as connection:
        assert (
            connection.scalar(select(AgentRun).where(AgentRun.run_id == accepted["run_id"])) is None
        )
        assert (
            connection.scalar(
                select(Message).where(Message.conversation_id == conversation["conversation_id"])
            )
            is None
        )
        assert (
            connection.scalar(select(RunEvent).where(RunEvent.run_id == accepted["run_id"])) is None
        )
        assert connection.scalar(select(User).where(User.username_normalized == "first_user"))
    engine.dispose()
