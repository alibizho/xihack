# 事务 Agent 联调记录

> 2026-10-03 更新：以下内容记录旧版本的故障。修复代码已纳入本仓库 `backend/`：可选工具参数不再使用可空 schema；provider 只接受 MiMo 的结构化 `message.tool_calls`，并阻止原始工具标记进入回答；对话可通过 `/api/conversations/{conversation_id}/proposal-ids` 恢复待确认提案。隔离环境的真实 MiMo 查询与提案循环、PostgreSQL 49 项测试已通过。正式站点更新与账号联调仍待完成，详见 [修复交接](../backend/docs/mimo-agent-repair-2026-10-03.md)。

日期：2026-10-02。后端部署使用 `yassay1/shixu-backend` 的 `1c0e28d`，模型为 `mimo-v2.6-flash`。本文仅记录联调证据，没有改动同学 2 的后端源码。

## 已通过

- HTTPS 注册、`/auth/me`、CSRF、任务创建提案和确认、任务列表、对话创建、run 提交。
- 不调用工具的简短问候 run `completed`；其 SSE 接口返回 `text/event-stream` 和 5 个事件。
- `/api/transcriptions` 对“明天下午三点提醒我整理联调任务”返回 `intent=create`、分钟精度时间。

## 当前阻塞：事务工具调用

对已有一条事务的账号发送“我有几项待办？请简短回答”，run 返回 `failed / INVALID_TOOL_CALL`。重复运行、将单次输出限额从默认值调到 1024，结果相同。独立读取 MiMo 流式响应时，首轮 `finish_reason=tool_calls`、`completion_tokens=70`，但结构化 `tool_calls[0].function.arguments` 拼接后只有 12 个字符（以 `{"keyword": ` 开头，JSON 未闭合）。同时 `delta.content` 包含 `<tool_call><function=search_tasks>...` 形式的完整文本。现有 `MimoClient` 只拼接结构化参数；`AgentRuntime` 会把这段工具标记文本当作面向用户的内容。后续请求反复搜索，偶尔将函数名拼成 `search_taskssearch_tasks`，最终触发 `INVALID_TOOL_CALL`。

建议由后端实现者在 provider 边界核对 MiMo-V2.6 的混合内容与结构化工具流，确认是否是模型兼容性或请求参数问题；只在参数完整、函数名合法时执行 Tool，并避免把工具标记当作最终回答。当前 API 缺少按 run 列举其待确认提案的结构化字段，前端只能从助手文字中的提案编号尝试读取，建议另补稳定关联。修复后重跑真实任务查询、Agent 提案确认和 SSE 断线重连。

## 专用密钥后的线上复测

同日改为后端专用 MiMo 密钥后，简短问候 run 仍可 `completed`，SSE 返回事件，说明后端确实调用了模型。对已有任务的临时账号进行两组真实请求：

- “我现在有哪些待办？”有一次 run 被标记为 `completed`，但 `assistant_content` 以原始 `<tool_call><function=search_tasks>` 标记开头，没有列出任务；另一次返回 `failed / INVALID_TOOL_CALL`。
- “请帮我创建一项待办，先生成待确认提案”返回 `failed / INVALID_TOOL_CALL`。查询该临时账号的 `proposals` 表，仅有手动 API 创建的提案，没有 `source=agent` 的提案。

因此模型请求链路可达，但查询和提案工具链仍不可用。完成状态也不能单独作为用户收到有效答案的依据。临时账号及其数据已从正式数据库清除；完整测试范围见 [全链路验收记录](full-chain-test-2026-10-02.md)。
