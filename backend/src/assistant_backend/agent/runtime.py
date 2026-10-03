import json
import time
from collections import defaultdict

from assistant_backend.agent.provider import MimoClient, ProviderFailure, ToolCallDelta
from assistant_backend.agent.tools import ProposalTaskTools, ReadOnlyTaskTools, TASK_TOOLS
from assistant_backend.application.agent_runs import AgentRunService, RunFailure
from assistant_backend.application.tasks import TaskService
from assistant_backend.config import Settings


SYSTEM_PROMPT = """你是拾序的事务助理。只回答用户问题，必要时调用任务查询工具。
你可以为创建、修改、完成或删除任务保存结构化待确认提案，但绝不能直接写入任务；
提案必须等待用户通过确认接口明确确认。不得声称任务已写入。信息不足时先追问。
只使用当前对话和工具返回的数据，不推测其他对话或未提供的个人信息。
工具参数不得包含 user_id。简洁、明确地用中文回复，不输出思维过程。"""


class AgentRuntime:
    def __init__(
        self,
        runs: AgentRunService,
        tasks: TaskService,
        provider: MimoClient,
        settings: Settings,
    ) -> None:
        self.runs = runs
        self.tasks = tasks
        self.provider = provider
        self.settings = settings

    def execute(self, run_id: str, worker_id: str) -> None:
        started = time.monotonic()
        try:
            user_id, _, history = self.runs.load_messages(run_id)
            messages: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}, *history]
            tools = ReadOnlyTaskTools(self.tasks, user_id)
            proposal_tools = ProposalTaskTools(self.tasks, user_id, run_id)
            used_input = 0
            used_output = 0
            tool_calls_used = 0

            for request_number in range(self.settings.agent_max_model_requests):
                if time.monotonic() - started >= self.settings.agent_max_run_seconds:
                    self._fail(run_id, worker_id, "RUN_TIMEOUT")
                    return
                estimated_input = self._estimate_tokens(
                    json.dumps(messages, ensure_ascii=False, separators=(",", ":"))
                )
                if used_input + estimated_input > self.settings.agent_max_input_tokens:
                    self._fail(run_id, worker_id, "INPUT_TOKEN_LIMIT")
                    return
                remaining_output = self.settings.agent_max_output_tokens - used_output
                if remaining_output <= 0:
                    self._fail(run_id, worker_id, "OUTPUT_TOKEN_LIMIT")
                    return

                if not self.runs.append_event(
                    run_id,
                    worker_id,
                    "run.status",
                    {"run_id": run_id, "phase": "thinking"},
                    phase="thinking",
                ):
                    return

                calls: dict[int, ToolCallDelta] = defaultdict(lambda: ToolCallDelta(index=0))
                response_text: list[str] = []
                request_input_tokens = 0
                request_output_tokens = 0
                try:
                    for chunk in self.provider.stream_chat(
                        messages,
                        TASK_TOOLS,
                        max_output_tokens=min(4096, remaining_output),
                    ):
                        if time.monotonic() - started >= self.settings.agent_max_run_seconds:
                            self._fail(run_id, worker_id, "RUN_TIMEOUT")
                            return
                        request_input_tokens = max(request_input_tokens, chunk.input_tokens)
                        request_output_tokens = max(request_output_tokens, chunk.output_tokens)
                        for part in chunk.tool_calls:
                            aggregate = calls[part.index]
                            aggregate.index = part.index
                            aggregate.call_id = self._merge_identifier(
                                aggregate.call_id, part.call_id
                            )
                            aggregate.name = self._merge_identifier(aggregate.name, part.name)
                            aggregate.arguments += part.arguments
                        if chunk.content:
                            response_text.append(chunk.content)
                except ProviderFailure as exc:
                    self._fail(run_id, worker_id, exc.code)
                    return

                used_input += request_input_tokens or estimated_input
                response_string = "".join(response_text)
                call_output = json.dumps(
                    [{"name": call.name, "arguments": call.arguments} for call in calls.values()],
                    ensure_ascii=False,
                )
                used_output += request_output_tokens or self._estimate_tokens(
                    response_string + call_output
                )
                if used_output > self.settings.agent_max_output_tokens:
                    self._fail(run_id, worker_id, "OUTPUT_TOKEN_LIMIT")
                    return
                if calls:
                    call_values = [calls[index] for index in sorted(calls)]
                    tool_calls_used += len(call_values)
                    if tool_calls_used > self.settings.agent_max_tool_calls:
                        self._fail(run_id, worker_id, "TOOL_CALL_LIMIT")
                        return
                    assistant_calls = []
                    for call in call_values:
                        if (
                            call.name
                            not in {
                                "search_tasks",
                                "get_task",
                                "propose_create_task",
                                "propose_update_task",
                                "propose_complete_task",
                                "propose_delete_task",
                            }
                            or not call.call_id
                            or len(call.arguments) > 8000
                        ):
                            self._fail(run_id, worker_id, "INVALID_TOOL_CALL")
                            return
                        try:
                            arguments = json.loads(call.arguments)
                        except json.JSONDecodeError:
                            self._fail(run_id, worker_id, "INVALID_TOOL_CALL")
                            return
                        if not isinstance(arguments, dict):
                            self._fail(run_id, worker_id, "INVALID_TOOL_CALL")
                            return
                        assistant_calls.append(
                            {
                                "id": call.call_id,
                                "type": "function",
                                "function": {"name": call.name, "arguments": call.arguments},
                            }
                        )
                    messages.append(
                        {
                            "role": "assistant",
                            "content": None,
                            "tool_calls": assistant_calls,
                        }
                    )
                    for call in call_values:
                        if time.monotonic() - started >= self.settings.agent_max_run_seconds:
                            self._fail(run_id, worker_id, "RUN_TIMEOUT")
                            return
                        if not self.runs.append_event(
                            run_id,
                            worker_id,
                            "run.status",
                            {"run_id": run_id, "phase": "searching_tasks"},
                            phase="searching_tasks",
                        ):
                            return
                        if call.name.startswith("propose_"):
                            result = proposal_tools.invoke(call.name, call.arguments, call.call_id)
                        else:
                            result = tools.invoke(call.name, call.arguments)
                        messages.append(
                            {"role": "tool", "tool_call_id": call.call_id, "content": result}
                        )
                    continue

                final_content = response_string.strip()
                if "<tool_call" in final_content.lower():
                    self._fail(run_id, worker_id, "MODEL_INVALID_RESPONSE")
                    return
                if not final_content:
                    self._fail(run_id, worker_id, "EMPTY_MODEL_RESPONSE")
                    return
                if not self._append_delta(run_id, worker_id, final_content):
                    return
                self.runs.complete(
                    run_id,
                    worker_id,
                    final_content,
                    used_input,
                    used_output,
                )
                return

            self._fail(run_id, worker_id, "MODEL_REQUEST_LIMIT")
        except RunFailure as exc:
            self._fail(run_id, worker_id, exc.code)
        except Exception:
            self._fail(run_id, worker_id, "INTERNAL_ERROR")

    def _fail(self, run_id: str, worker_id: str, code: str) -> None:
        self.runs.fail(run_id, worker_id, code)

    def _append_delta(self, run_id: str, worker_id: str, text: str) -> bool:
        return self.runs.append_event(
            run_id,
            worker_id,
            "message.delta",
            {"run_id": run_id, "text": text},
            phase="answering",
        )

    @staticmethod
    def _estimate_tokens(value: str) -> int:
        return max(1, (len(value.encode("utf-8")) + 2) // 3)

    @staticmethod
    def _merge_identifier(current: str, fragment: str) -> str:
        if not fragment or fragment == current:
            return current
        if fragment.startswith(current):
            return fragment
        return current + fragment
