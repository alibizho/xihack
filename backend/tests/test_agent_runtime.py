import json
from types import SimpleNamespace

from assistant_backend.agent.provider import ChatDelta, ToolCallDelta
from assistant_backend.agent.runtime import AgentRuntime
from assistant_backend.config import Settings


def test_tool_call_text_is_never_emitted_or_saved_as_answer() -> None:
    class Runs:
        def __init__(self) -> None:
            self.events = []
            self.answer = None
            self.failure = None

        def load_messages(self, run_id):
            return "user-1", "conversation-1", [{"role": "user", "content": "有几项待办？"}]

        def append_event(self, run_id, worker_id, event_type, payload, **kwargs):
            self.events.append((event_type, payload))
            return True

        def complete(self, run_id, worker_id, content, input_tokens, output_tokens):
            self.answer = content

        def fail(self, run_id, worker_id, code):
            self.failure = code

    class Tasks:
        def list(self, user_id, **kwargs):
            return SimpleNamespace(model_dump=lambda **_: {"items": [{"title": "准备展示"}]})

    class Provider:
        def __init__(self) -> None:
            self.calls = 0

        def stream_chat(self, messages, tools, max_output_tokens):
            self.calls += 1
            if self.calls == 1:
                yield ChatDelta(
                    content='<tool_call><function=search_tasks>{"keyword":null}</tool_call>',
                    tool_calls=[
                        ToolCallDelta(
                            index=0,
                            call_id="call-1",
                            name="search_tasks",
                            arguments=json.dumps({"keyword": None}),
                        )
                    ],
                )
            else:
                assert any(message["role"] == "tool" for message in messages)
                yield ChatDelta(content="你有 1 项待办。")

    runs = Runs()
    AgentRuntime(runs, Tasks(), Provider(), Settings(_env_file=None)).execute("run-1", "worker-1")
    assert runs.failure is None
    assert runs.answer == "你有 1 项待办。"
    assert all("<tool_call" not in str(payload) for _, payload in runs.events)


def test_incomplete_tool_arguments_are_rejected_before_execution() -> None:
    class Runs:
        def __init__(self) -> None:
            self.failure = None

        def load_messages(self, run_id):
            return "user-1", "conversation-1", [{"role": "user", "content": "有几项待办？"}]

        def append_event(self, *args, **kwargs):
            return True

        def fail(self, run_id, worker_id, code):
            self.failure = code

    class Tasks:
        def list(self, *args, **kwargs):
            raise AssertionError("incomplete arguments must not reach the task service")

    class Provider:
        def stream_chat(self, messages, tools, max_output_tokens):
            yield ChatDelta(
                tool_calls=[
                    ToolCallDelta(
                        index=0, call_id="call-1", name="search_tasks", arguments='{"keyword":'
                    )
                ]
            )

    runs = Runs()
    AgentRuntime(runs, Tasks(), Provider(), Settings(_env_file=None)).execute("run-1", "worker-1")
    assert runs.failure == "INVALID_TOOL_CALL"
