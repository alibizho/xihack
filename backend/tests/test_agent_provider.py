import io
import json
from urllib.error import HTTPError, URLError

import pytest
from pydantic import SecretStr

from assistant_backend.agent.provider import (
    ChatCompletionClient,
    ChatDelta,
    ChatReportAnalyzer,
    ProviderFailure,
)
from assistant_backend.agent.tools import TASK_TOOLS, ProposalTaskTools
from assistant_backend.config import Settings


class FakeResponse(io.BytesIO):
    def __init__(self, value: dict) -> None:
        super().__init__(json.dumps(value).encode())

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *_args: object) -> None:
        return None


def test_mimo_client_parses_tool_response_and_keeps_api_key_in_header(monkeypatch) -> None:
    seen = {}
    response = FakeResponse(
        {
            "choices": [
                {
                    "finish_reason": "tool_calls",
                    "message": {
                        "content": None,
                        "tool_calls": [
                            {
                                "id": "call-1",
                                "type": "function",
                                "function": {"name": "get_task", "arguments": '{"task_id":"abc"}'},
                            }
                        ],
                    },
                }
            ],
            "usage": {"prompt_tokens": 12, "completion_tokens": 4},
        }
    )

    def fake_urlopen(request, timeout):
        seen["request"] = request
        seen["timeout"] = timeout
        return response

    monkeypatch.setattr("assistant_backend.agent.provider.urlopen", fake_urlopen)
    client = ChatCompletionClient(
        SecretStr("unit-test-key"), "https://api.xiaomimimo.com/v1", "mimo-v2.6-flash"
    )
    chunks = list(client.stream_chat([{"role": "user", "content": "test"}], [], 8))
    assert "" == "".join(chunk.content for chunk in chunks)
    assert chunks[0].tool_calls[0].name == "get_task"
    assert chunks[0].tool_calls[0].arguments == '{"task_id":"abc"}'
    assert chunks[-1].input_tokens == 12
    assert chunks[-1].output_tokens == 4
    assert seen["request"].full_url == "https://api.xiaomimimo.com/v1/chat/completions"
    assert seen["request"].get_header("Authorization") == "Bearer unit-test-key"
    assert seen["request"].get_header("User-agent") == "ShixuBackend/0.3"
    assert seen["timeout"] == 35
    request_body = json.loads(seen["request"].data)
    assert request_body["model"] == "mimo-v2.6-flash"
    assert request_body["max_completion_tokens"] == 8
    assert request_body["stream"] is False
    assert request_body["thinking"] == {"type": "enabled"}


@pytest.mark.parametrize(
    ("http_status", "expected_code"),
    [(401, "MODEL_AUTH_FAILED"), (403, "MODEL_ACCESS_DENIED")],
)
def test_mimo_client_maps_provider_auth_failure_without_response_body(
    monkeypatch, http_status: int, expected_code: str
) -> None:
    def unauthorized(_request, timeout):
        del timeout
        raise HTTPError(
            "https://api.xiaomimimo.com/v1/chat/completions",
            http_status,
            "Unauthorized",
            {},
            io.BytesIO(b"sensitive provider response"),
        )

    monkeypatch.setattr("assistant_backend.agent.provider.urlopen", unauthorized)
    client = ChatCompletionClient(
        SecretStr("unit-test-key"), "https://api.xiaomimimo.com/v1", "mimo-v2.6-flash"
    )
    with pytest.raises(ProviderFailure) as error:
        list(client.stream_chat([{"role": "user", "content": "test"}], [], 8))
    assert error.value.code == expected_code
    assert "sensitive" not in str(error.value)


@pytest.mark.parametrize(
    "first_failure", [URLError("offline"), HTTPError("url", 503, "", {}, None)]
)
def test_client_retries_one_transient_provider_failure(monkeypatch, first_failure) -> None:
    attempts = 0

    def flaky_urlopen(_request, timeout):
        nonlocal attempts
        assert timeout == 35
        attempts += 1
        if attempts == 1:
            raise first_failure
        return FakeResponse(
            {"choices": [{"finish_reason": "stop", "message": {"content": "ready"}}]}
        )

    monkeypatch.setattr("assistant_backend.agent.provider.urlopen", flaky_urlopen)
    client = ChatCompletionClient(
        SecretStr("unit-test-key"), "https://api.openai-next.com/v1", "deepseek-v3.2"
    )
    assert "".join(chunk.content for chunk in client.stream_chat([], [], 8)) == "ready"
    assert attempts == 2


def test_mimo_base_url_cannot_send_key_to_unapproved_host() -> None:
    with pytest.raises(ValueError, match="official HTTPS API endpoint"):
        Settings(_env_file=None, mimo_base_url="https://not-mimo.example/v1")


def test_mimo_is_selected_even_when_other_gateway_key_exists(monkeypatch) -> None:
    seen = {}

    def fake_urlopen(request, timeout):
        seen["request"] = request
        assert timeout == 35
        return FakeResponse(
            {"choices": [{"finish_reason": "stop", "message": {"content": "好的"}}]}
        )

    monkeypatch.setattr("assistant_backend.agent.provider.urlopen", fake_urlopen)
    settings = Settings(
        _env_file=None,
        openai_next_api_key="gateway-test-key",
        mimo_api_key="mimo-test-key",
    )
    client = ChatCompletionClient(*settings.chat_provider)
    tools = TASK_TOOLS
    assert (
        "".join(
            chunk.content
            for chunk in client.stream_chat([{"role": "user", "content": "明天交作业"}], tools, 100)
        )
        == "好的"
    )
    request = seen["request"]
    body = json.loads(request.data)
    assert request.full_url == "https://api.xiaomimimo.com/v1/chat/completions"
    assert request.get_header("Authorization") == "Bearer mimo-test-key"
    assert body["model"] == "mimo-v2.6-flash"
    assert body["max_completion_tokens"] == 100
    assert body["tool_choice"] == "auto"
    search = next(
        tool["function"] for tool in body["tools"] if tool["function"]["name"] == "search_tasks"
    )
    create = next(
        tool["function"]
        for tool in body["tools"]
        if tool["function"]["name"] == "propose_create_task"
    )
    assert search["strict"] is False
    assert search["parameters"]["properties"]["keyword"]["type"] == "string"
    assert "keyword" not in search["parameters"]["required"]
    assert "anyOf" in create["parameters"]["properties"]["task"]["properties"]["due"]
    assert "category" in create["parameters"]["properties"]["task"]["required"]
    assert body["thinking"] == {"type": "enabled"}
    assert (
        next(tool for tool in tools if tool["function"]["name"] == "search_tasks")["function"][
            "strict"
        ]
        is False
    )


def test_openai_next_base_url_cannot_send_key_to_unapproved_host() -> None:
    with pytest.raises(ValueError, match="official HTTPS API endpoint"):
        Settings(_env_file=None, openai_next_base_url="https://example.com/v1")


def test_report_analyzer_accepts_fenced_json_from_deepseek() -> None:
    class FencedJsonClient:
        def stream_chat(self, messages, tools, max_output_tokens):
            del messages, tools, max_output_tokens
            yield ChatDelta(
                content='```json\n{"summary":"完成了","blocker":"耗时","next_step":"先限时"}\n```'
            )

    insight = ChatReportAnalyzer(FencedJsonClient())("task", "report")
    assert insight.summary == "完成了"
    assert insight.next_step == "先限时"


def test_create_proposal_requires_interpreted_fields_before_saving() -> None:
    class Service:
        def create_proposal(self, *_args, **_kwargs):
            raise AssertionError("An incomplete transcript must not become a proposal")

    tools = ProposalTaskTools(Service(), "user", "run")
    result = tools.invoke(
        "propose_create_task",
        json.dumps({"task": {"title": "I need to meet my professor tomorrow at 3 pm"}}),
        "call",
    )
    assert json.loads(result)["error"] == "incomplete_task"
    create = next(
        tool["function"] for tool in TASK_TOOLS if tool["function"]["name"] == "propose_create_task"
    )
    assert set(create["parameters"]["properties"]["task"]["required"]) == {
        "title",
        "category",
        "importance",
        "urgency",
    }
