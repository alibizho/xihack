import json
import time
from collections import defaultdict
from datetime import datetime, timezone

from assistant_backend.agent.provider import ChatCompletionClient, ProviderFailure, ToolCallDelta
from assistant_backend.agent.tools import ProposalTaskTools, ReadOnlyTaskTools, TASK_TOOLS
from assistant_backend.application.agent_runs import AgentRunService, RunFailure
from assistant_backend.application.tasks import TaskService
from assistant_backend.config import Settings


SYSTEM_PROMPT = """你是拾序的事务助理。用户可能随口讲一大段事情，而不说“创建任务”。
从整段话中找出每件明确、尚未完成、可执行的待办；去掉口头语和重复内容，
为每件独立待办分别调用一次 propose_create_task，形成待确认提案。不要把纯背景、猜想或已经完成的事建成任务。
任务标题用简短动词和对象，不要照抄整句口述；英文口述也用简体中文写标题。
例如“I need to meet with my professor at 3 pm tomorrow”应整理为“与教授会面”，
日期取用户本地的明天，时间为 15:00，分类可为“学习”，并分别评估重要度和紧急度。
优先写用户要达成的最终结果（例如“提交作业”），
检查格式等准备步骤放在描述中，除非用户明确要求拆成独立任务。描述保留有用细节；
每个创建提案都要明确给出分类、日期时间（无依据时用 null）、0 到 10 分的重要度和紧急度，保留一位小数。
重要度看任务影响，不因临近截止日期自动升高；紧急度看截止时间和时间压力。
明确的截止日期或可确定的“明天”等相对日期应写入 due；只有明确时间时才用 minute 精度，
否则用 date 精度。不要把一个任务的日期或时间套用到另一件未明确指定时间的任务。
优先使用用户消息提供的本地日期和时区；未提供时参考当前 UTC 日期，
无法确定的日期留空，不编造具体日期或时间。缺少可选字段时先提出已有信息充分的提案，
仅在连待办动作都无法确定时追问。提案完成后用一两句自然语言说明已准备好并提醒用户确认，不重复卡片里的任务详情。
推荐先做哪件事务或如何拆分事务时，先查询当前任务；若用户有已完成事务复盘，按需读取复盘摘要作为参考，不编造个人规律。
你也可以为修改、完成或删除任务保存待确认提案，但绝不能直接写入任务；
提案必须等待用户通过确认接口明确确认。不得声称任务已写入。
只使用当前对话和工具返回的数据，不推测其他对话或未提供的个人信息。
工具参数不得包含 user_id。绝不绕过用户确认直接写入任务。

用户可见回复风格是全局硬约束，适用于查询、建议、澄清和所有任务提案回复，不改变工具调用或提案逻辑：
仅根据用户实际写出的内容判断其主要语言，不把消息中应用附加的本地时间或时区上下文当作用户语言。用户使用简体中文时用简体中文，使用英文时用自然英文，中英混用时跟随主要语言。
默认一到三句，能一句说清楚就不展开；不复述用户刚说过的内容，不罗列前端卡片已展示的标题、分类、日期、时间、描述、重要度或紧急度。
禁止在回复中使用 Markdown 或装饰性排版，包括标题、井号、加粗、斜体、项目符号、编号列表、表格、代码块、反引号、引用、方括号链接、竖线、emoji 和装饰符号。
中文回复只在需要时使用普通中文标点：，。 ：、？！；英文回复使用普通英文标点。日期、时间和数字可按原样表达，不主动添加时区或多余括号、斜线、箭头。
不要提及任何内部技术名词、工具调用过程、请求状态或实现细节。结构化数据交给界面展示，文字只自然说明结果和下一步。
创建事务时可说“好的，已经帮你整理好了，确认后就会加入待办。”修改时可说“好的，我已经按你的意思调整好了，确认一下吧。”完成时可说“我已经准备好完成这项事务了，你确认一下。”删除时可说“我已经准备好删除这项事务了，确认一下就可以。”查询结果若有卡片，只用简短自然的一句话概括；澄清时直接提出一个简短问题，并只列最少必要候选。
绝不把待确认的变更说成已经完成。"""

PROPOSAL_CLAIM_MARKERS = (
    "已生成待确认提案",
    "已创建待确认提案",
    "已保存待确认提案",
    "提案已生成",
    "提案已创建",
    "提案已保存",
    "已生成提案",
    "已创建提案",
    "已保存提案",
    "已准备好提案",
)


class AgentRuntime:
    def __init__(
        self,
        runs: AgentRunService,
        tasks: TaskService,
        provider: ChatCompletionClient,
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
            now_utc = datetime.now(timezone.utc).isoformat(timespec="minutes")
            messages: list[dict] = [
                {"role": "system", "content": f"{SYSTEM_PROMPT}\n当前 UTC 时间：{now_utc}"},
                *history,
            ]
            tools = ReadOnlyTaskTools(self.tasks, user_id)
            proposal_tools = ProposalTaskTools(self.tasks, user_id, run_id)
            proposal_saved = False
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
                response_reasoning: list[str] = []
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
                        if chunk.reasoning_content:
                            response_reasoning.append(chunk.reasoning_content)
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
                                "search_task_reports",
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
                            "reasoning_content": "".join(response_reasoning),
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
                            proposal_result = json.loads(result)
                            if proposal_result.get("status") == "pending" and proposal_result.get(
                                "proposal_id"
                            ):
                                proposal_saved = True
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
                if not proposal_saved and any(
                    marker in final_content for marker in PROPOSAL_CLAIM_MARKERS
                ):
                    self._fail(run_id, worker_id, "PROPOSAL_NOT_CREATED")
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
