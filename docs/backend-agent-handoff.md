# 事务 Agent 联调记录

日期：2026-10-02。后端部署使用 `yassay1/shixu-backend` 的 `1c0e28d`，模型为 `mimo-v2.6-flash`。本文仅记录联调证据，没有改动同学 2 的后端源码。

## 已通过

- HTTPS 注册、`/auth/me`、CSRF、任务创建提案和确认、任务列表、对话创建、run 提交。
- 不调用工具的简短问候 run `completed`；其 SSE 接口返回 `text/event-stream` 和 5 个事件。
- `/api/transcriptions` 对“明天下午三点提醒我整理联调任务”返回 `intent=create`、分钟精度时间。

## 当前阻塞：事务工具调用

对已有一条事务的账号发送“我有几项待办？请简短回答”，run 返回 `failed / INVALID_TOOL_CALL`。重复运行、将单次输出限额从默认值调到 1024，结果相同。独立读取 MiMo 流式响应时，首轮 `finish_reason=tool_calls`、`completion_tokens=70`，但结构化 `tool_calls[0].function.arguments` 拼接后只有 12 个字符（以 `{"keyword": ` 开头，JSON 未闭合）。同时 `delta.content` 包含 `<tool_call><function=search_tasks>...` 形式的完整文本。现有 `MimoClient` 只拼接结构化参数；`AgentRuntime` 会把这段工具标记文本当作面向用户的内容。后续请求反复搜索，偶尔将函数名拼成 `search_taskssearch_tasks`，最终触发 `INVALID_TOOL_CALL`。

建议由后端实现者在 provider 边界核对 MiMo-V2.6 的混合内容与结构化工具流，确认是否是模型兼容性或请求参数问题；只在参数完整、函数名合法时执行 Tool，并避免把工具标记当作最终回答。当前 API 缺少按 run 列举其待确认提案的结构化字段，前端只能从助手文字中的提案编号尝试读取，建议另补稳定关联。修复后重跑真实任务查询、Agent 提案确认和 SSE 断线重连。
