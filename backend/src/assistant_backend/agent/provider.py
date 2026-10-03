import json
from collections.abc import Iterator
from dataclasses import dataclass, field
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from uuid import uuid4

from pydantic import SecretStr

from assistant_backend.application.reports import ReportInsight


@dataclass
class ToolCallDelta:
    index: int
    call_id: str = ""
    name: str = ""
    arguments: str = ""


@dataclass
class ChatDelta:
    content: str = ""
    reasoning_content: str = ""
    tool_calls: list[ToolCallDelta] = field(default_factory=list)
    input_tokens: int = 0
    output_tokens: int = 0


class ProviderFailure(Exception):
    def __init__(self, code: str, retryable: bool) -> None:
        self.code = code
        self.retryable = retryable


def _deepseek_schema(schema: dict) -> dict:
    if "anyOf" in schema:
        variants = [part for part in schema["anyOf"] if part.get("type") == "object"]
        properties = {
            name: _deepseek_schema(value)
            for variant in variants
            for name, value in variant["properties"].items()
            if name != "precision"
        }
        properties["precision"] = {"type": "string", "enum": ["date", "minute"]}
        return {
            "type": "object",
            "description": "Use precision=date with date, or precision=minute with at; include timezone.",
            "properties": properties,
            "required": ["precision", "timezone"],
            "additionalProperties": False,
        }
    result = dict(schema)
    if isinstance(result.get("type"), list):
        result["type"] = next(value for value in result["type"] if value != "null")
    if "const" in result:
        result["type"] = "string"
    if "enum" in result:
        result["enum"] = [value for value in result["enum"] if value is not None]
    if "properties" in result:
        original = result["properties"]
        result["properties"] = {name: _deepseek_schema(value) for name, value in original.items()}
        result["required"] = [
            name
            for name in result.get("required", [])
            if "null" not in original[name].get("type", [])
            and not any(part.get("type") == "null" for part in original[name].get("anyOf", []))
        ]
    return result


class ChatCompletionClient:
    """Small OpenAI-compatible client; errors never include provider bodies."""

    def __init__(self, api_key: SecretStr | None, base_url: str, model: str) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model

    def stream_chat(
        self,
        messages: list[dict],
        tools: list[dict],
        max_output_tokens: int,
    ) -> Iterator[ChatDelta]:
        if self.api_key is None or not self.api_key.get_secret_value():
            raise ProviderFailure("MODEL_NOT_CONFIGURED", False)
        is_mimo = self.base_url == "https://api.xiaomimimo.com/v1"
        payload: dict = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "max_completion_tokens" if is_mimo else "max_tokens": max_output_tokens,
        }
        if is_mimo:
            payload["thinking"] = {"type": "enabled"}
        if tools:
            payload["tools"] = (
                tools
                if is_mimo
                else [
                    {
                        **tool,
                        "function": {
                            key: value
                            for key, value in tool["function"].items()
                            if key not in {"strict", "parameters"}
                        }
                        | {"parameters": _deepseek_schema(tool["function"]["parameters"])},
                    }
                    for tool in tools
                ]
            )
            payload["tool_choice"] = (
                "required"
                if not is_mimo and messages and messages[-1]["role"] == "user"
                else "auto"
            )
        body = json.dumps(payload, ensure_ascii=False).encode()
        request = Request(
            f"{self.base_url}/chat/completions",
            data=body,
            headers={
                "Authorization": f"Bearer {self.api_key.get_secret_value()}",
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": "ShixuBackend/0.3",
            },
            method="POST",
        )
        for attempt in range(2):
            try:
                with urlopen(request, timeout=35) as response:
                    try:
                        result = json.load(response)
                        choice = result["choices"][0]
                        message = choice["message"]
                        finish_reason = choice["finish_reason"]
                        usage = result.get("usage") or {}
                        tool_calls = message.get("tool_calls") or []
                        reasoning_content = message.get("reasoning_content") or ""
                        if not isinstance(reasoning_content, str):
                            raise ValueError("invalid reasoning content")
                        if finish_reason == "tool_calls" and tool_calls:
                            calls = []
                            for index, part in enumerate(tool_calls):
                                if part["type"] != "function":
                                    raise ValueError("unexpected tool type")
                                function = part["function"]
                                if not isinstance(function["name"], str) or not isinstance(
                                    function["arguments"], str
                                ):
                                    raise ValueError("invalid function call")
                                calls.append(
                                    ToolCallDelta(
                                        index=index,
                                        call_id=part.get("id") or f"call_{uuid4().hex}",
                                        name=function["name"],
                                        arguments=function["arguments"],
                                    )
                                )
                            content = ""
                        elif finish_reason == "stop" and not tool_calls:
                            content = message["content"]
                            if not isinstance(content, str) or "<tool_call" in content.lower():
                                raise ValueError("invalid final answer")
                            calls = []
                        elif finish_reason == "length":
                            raise ProviderFailure("MODEL_TRUNCATED_RESPONSE", True)
                        else:
                            raise ValueError("invalid finish reason")
                        yield ChatDelta(
                            content=content,
                            reasoning_content=reasoning_content,
                            tool_calls=calls,
                            input_tokens=int(usage.get("prompt_tokens", 0)),
                            output_tokens=int(usage.get("completion_tokens", 0)),
                        )
                        return
                    except (KeyError, IndexError, TypeError, ValueError) as exc:
                        raise ProviderFailure("MODEL_INVALID_RESPONSE", True) from exc
            except HTTPError as exc:
                status = exc.code
                if status >= 500 and attempt == 0:
                    continue
                if status == 401:
                    raise ProviderFailure("MODEL_AUTH_FAILED", False) from None
                if status == 403:
                    raise ProviderFailure("MODEL_ACCESS_DENIED", False) from None
                if status == 429:
                    raise ProviderFailure("MODEL_RATE_LIMITED", True) from None
                raise ProviderFailure("MODEL_PROVIDER_ERROR", status >= 500) from None
            except (URLError, TimeoutError, OSError) as exc:
                if attempt == 0:
                    continue
                raise ProviderFailure("MODEL_UNAVAILABLE", True) from exc


class ChatReportAnalyzer:
    def __init__(self, client: ChatCompletionClient) -> None:
        self.client = client

    def __call__(self, title: str, body: str) -> ReportInsight:
        prompt = (
            "你分析用户完成事务后的简短复盘。只返回 JSON，恰好有 summary、blocker、next_step 三个字符串。"
            "summary 简述实际完成情况；blocker 提取阻碍，未提及则为空；"
            "next_step 提取下次可执行的改进，证据不足则为空。"
            "只根据报告内容，不诊断健康或推测人格。每个字段不超过 240 字。"
        )
        content = "".join(
            delta.content
            for delta in self.client.stream_chat(
                [
                    {"role": "system", "content": prompt},
                    {
                        "role": "user",
                        "content": json.dumps({"task": title, "report": body}, ensure_ascii=False),
                    },
                ],
                [],
                500,
            )
        ).strip()
        if content.startswith("```json\n") and content.endswith("```"):
            content = content[8:-3].strip()
        return ReportInsight.model_validate_json(content)
