# MiMo 事务工具调用修复交接（2026-10-03）

## 原因与改动

用合成请求直连 `mimo-v2.6-flash` 复现了旧故障：原 `search_tasks` schema 使用可空类型并要求传入全部筛选字段时，响应的 `finish_reason` 为 `tool_calls`，但 `message.tool_calls` 为空，调用内容仅以 `<tool_call>` 文本出现。只关闭 `strict` 仍复现；将可选字段改为可省略的非空类型后，同一模型返回结构化 `tool_calls`。创建提案工具也改为省略未提供的可选字段。

Provider 现在读取完整的非流式响应，按 `finish_reason` 区分工具调用和最终回答，拒绝没有结构化调用的工具响应及原始工具标记。Agent 运行层在确认最终回答后才发布 `message.delta`；所有工具参数先校验为 JSON 对象，再执行。新增 `GET /api/conversations/{conversation_id}/proposal-ids`，按账号和对话返回仍待确认的 Agent 提案编号；前端据此获取确认卡片，即使模型在保存提案后回答失败也能找回。任务写入仍只经确认接口。

正式站点首次部署复测又发现：关闭思考模式时，模型会直接声称“已生成提案”却不调用工具；只靠更强提示词仍复现。官方 Chat Completions 文档目前仅支持 `tool_choice=auto`，非 `auto` 值会被服务端移除，不能用 `required` 强制工具调用。再次直连真实模型，启用思考模式后返回结构化 `propose_create_task`；因此现改为思考模式，并按官方建议在同一轮工具循环中保留 `reasoning_content`。运行层还会拒绝“已生成提案”但没有任何成功提案工具结果的回答，避免误导用户。[官方接口说明](https://mimo.mi.com/docs/zh-CN/api/chat/openai-api)

## 验收状态

| 项目 | 状态 | 证据与限制 |
| --- | --- | --- |
| 工具结构化调用 | 通过 | 用完整六工具列表和合成请求直连真实 MiMo；查询返回 `search_tasks`，创建返回 `propose_create_task`，参数通过 Pydantic 校验。未发送真实用户数据。 |
| Agent 多轮循环 | 通过 | 真实 MiMo 加合成任务服务的查询与提案循环均完成，未输出 `<tool_call>` 标记。 |
| 旧故障回归 | 通过 | Provider、运行层和工具 schema 的针对性用例覆盖标记泄露、无效 JSON 与可空字段。 |
| PostgreSQL 集成 | 通过 | 本机独立 `shixu_agent_test` 库执行完整测试：49 passed；包含提案查询、跨账号隔离与确认后移除。 |
| 正式站点 | 复测中 | 第一版部署的任务查询通过；创建提案暴露了关闭思考模式时的虚假成功，已补修，待重新部署与验收。 |

非流式模型请求会使回答在模型完成后一次性送入现有 SSE 事件；运行状态及事件重连机制保留。恢复逐字流式展示前，应另行验证 MiMo 的每个 `delta.tool_calls` 分片及结束原因。不得解析 `<tool_call>` 文本来执行工具。
