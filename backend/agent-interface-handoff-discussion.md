# Agent 接口交接与问题讨论记录

> 记录日期：2026-10-02
> 文档性质：产品后端设计与当前代码之间的接口交接记录，不是实现提交，也不自动冻结未确认的产品决定。
> 目标：明确 Agent 的输入数据、输出协议、确认写入边界，以及当前后端需要补齐的接口差距。

> 语音决定更新（2026-10-02）：本文原有“上传后端转写”的建议已由 [ADR 0004](docs/adr-0004-local-voice.md) 取代。前端本地转写，后端校准和业务核验；默认只传文字。

> 进度更新：本文件保留阶段 4 时的差距讨论快照。阶段 5 任务提案 Tool 与阶段 6 后端文字校准/可选回退已实现；当前接口与剩余缺口以 [开发计划](docs/development-plan.md)、[API 契约](docs/api-contract.md) 和 [ADR 0005](docs/adr-0005-speech-stage-6.md) 为准。

## 1. 讨论范围与事实来源

本记录讨论的是“产品后端设计中的 Agent 接口”与当前 backend 实际实现之间的差异。

事实来源按以下优先级使用：

1. 用户提供的产品后端设计文档 backend-api-data-model.md：作为本次 Agent 能力目标的主要依据。
2. backend/docs/product-brief.md：产品边界、用户流程和数据生命周期。
3. backend/docs/agent-architecture.md：Agent 上下文、Tool、授权、确认和运行恢复原则。
4. backend/docs/api-contract.md：当前 API 契约、SSE 和错误语义。
5. backend/src/assistant_backend 与 backend/tests：当前实际代码和测试行为。

产品后端设计文档明确说明接口“尚未实现”，因此不能把其中的接口名称和字段直接当作当前线上能力。本文将“设计目标”和“代码现状”分开记录。

## 2. 核心结论

产品设计已经定义了 Agent 输入与输出标准，当前代码尚未完整实现这些标准。

当前代码是：

    对话消息
      → 持久化 user message 与 agent run
      → worker 调用 MiMo
      → Agent 只读查询任务
      → 返回普通助手文本

产品目标是：

    用户文本/转写文本 + 当前用户业务数据
      → Agent 按模式处理
      → 返回结构化草稿、建议或澄清问题
      → 用户确认
      → 业务接口写入任务、任务报告或状态记录

因此差距不是单纯“新增几个字段”，而是需要同时扩展：

- Agent 输入数据源；
- Agent 模式和请求协议；
- Agent 结构化输出 schema；
- Agent 输出到 proposal/业务写入用例的转换；
- task_reports 与 check_ins 数据模型；
- 语音转写到 Agent 的前后端数据流。

现有的账号隔离、Cookie 会话、任务确认、对话持久化、worker、run、SSE 和限流机制可以复用。

## 3. 产品设计定义的 Agent 输入标准

### 3.1 输入数据来源

Agent 应该只在当前已认证用户范围内读取以下数据：

| 输入 | 用途 | 当前代码状态 |
|---|---|---|
| 当前用户的任务 | 任务捕获、任务查询、建议 | 已有 tasks 和只读 Tool |
| 近期任务报告 | 了解完成、部分完成、受阻情况 | 未实现 task_reports |
| 近期自述状态 | 了解用户主动填写的心情、精力、压力 | 未实现 check_ins |
| 当前用户输入文本 | Agent 当前轮的业务请求 | 已有对话消息 content |
| 用户时区 | 解释日期、截止时间和建议 | 任务有时区；Agent 请求未单独接收 |
| 当前对话必要历史 | 维持当前对话上下文 | 已由 run 装配当前对话历史 |

以下数据不应作为 Agent 输入：

- 客户端任意指定的 user_id；
- 其他账号的任务、报告、状态或对话；
- 其他对话的历史和摘要；
- 未经用户明确表达而推断的情绪、压力或心理状态；
- 原始音频长期内容；
- 完整任务表的无关字段和无限历史；
- 模型内部推理文本。

### 3.2 输入模式

产品设计定义四种主要模式：

| 模式 | 目标 | 主要输入 | 预期输出 |
|---|---|---|---|
| task_capture | 从一句话整理任务草稿 | 文本、时区、必要任务上下文 | task_draft 或 clarification |
| task_report | 从一句话整理任务结果报告 | 文本、目标任务、必要任务信息 | report_draft 或 clarification |
| check_in | 整理用户主动表达的状态 | 文本、明确表达的状态字段 | check_in_draft 或 clarification |
| advice | 推荐一个可执行的下一步 | 文本、近期任务/报告/check-in | advice 或 clarification |

这些模式是产品语义，不应通过提示词自由扩展为任意 Tool 或任意数据库操作。

### 3.3 输入授权边界

Agent 读取数据时：

1. Web 请求由服务端会话解析当前用户。
2. Application 用例把内部 user_id 注入查询服务和 Tool。
3. 模型请求中不需要暴露 user_id。
4. Tool 参数不允许出现 user_id。
5. 每次按 ID 查询仍需在 Application 层校验归属。
6. Agent 只能读取当前对话和当前用户必要的业务数据。

Agent 不应直接访问 ORM、SQL 或数据库连接；所有数据读取通过 Application 用例或受控 Tool 完成。

## 4. 产品设计定义的 Agent 输出协议

### 4.1 顶层响应判别

Agent 响应应通过稳定的 type 判别，而不是让前端解析自然语言：

    type AgentResult =
      | TaskDraftResult
      | ReportDraftResult
      | CheckInDraftResult
      | AdviceResult
      | ClarificationResult;

每个响应至少应有：

    {
      "type": "task_draft",
      "requires_confirmation": true
    }

### 4.2 task_draft

用于创建或修改任务前展示给用户的草稿。

    {
      "type": "task_draft",
      "operation": "create",
      "task": {
        "title": "完成项目周报",
        "due_at": "2026-10-09T15:00:00+08:00",
        "timezone": "Asia/Shanghai",
        "importance": 8.0,
        "urgency": 6.0,
        "importance_reason": "与近期项目目标直接相关",
        "urgency_reason": "距离计划提交时间较近"
      },
      "clarification": null,
      "requires_confirmation": true
    }

task_draft 是 Agent 输出草稿，不代表任务已写入。前端确认后仍应调用统一任务提案确认流程。

### 4.3 report_draft

用于用户说“做完了一部分”“卡在某一步”等场景。

    {
      "type": "report_draft",
      "task_id": "task-123",
      "outcome": "partial",
      "note": "完成了提纲，还没有补充数据",
      "minutes_spent": 20,
      "requires_confirmation": true
    }

outcome 由产品文档定义为 done、partial、blocked。如果 Agent 无法可靠识别目标任务，必须返回 clarification，不能猜测任务 ID。

### 4.4 check_in_draft

用于整理用户主动表达的状态。它不是诊断，也不能从音调、语速或摄像头推断。

    {
      "type": "check_in_draft",
      "mood": 5.0,
      "energy": 3.0,
      "stress": 7.0,
      "note": "今天有点累",
      "requires_confirmation": true
    }

字段规则：

- mood、energy、stress 可分别缺省；
- 有值时范围为 0–10，支持一位小数；
- 只有用户明确表达的内容才能进入草稿；
- 不得把模型推断的情绪作为用户状态保存。

### 4.5 advice

用于推荐一个真实可执行的下一步。

    {
      "type": "advice",
      "summary": "先推进一件短任务，再评估精力。",
      "ranked_tasks": [
        {
          "task_id": "task-123",
          "reason": "今天截止，且可以拆成较小步骤",
          "next_step": "先花 10 分钟列出提纲"
        }
      ],
      "proposed_changes": [],
      "requires_confirmation": false
    }

建议标准：

- task_id 必须对应当前用户真实任务；
- reason 应基于任务、报告或用户状态中的可解释事实；
- next_step 应是可执行的下一步，不是泛泛鼓励；
- 建议本身不写入任务；
- 如果建议包含任务修改，必须变成结构化提案并要求确认；
- 没有足够数据时可以建议休息或询问用户，不得编造任务。

### 4.6 clarification

    {
      "type": "clarification",
      "question": "你说的“周报”是本周项目周报，还是英语展示的准备？",
      "requires_confirmation": false
    }

澄清不是错误，也不是数据库写入。前端应把问题显示给用户，用户回答后继续当前业务流程。

## 5. 当前代码实际 Agent 接口

当前公开接口是：

    POST /api/conversations/{conversation_id}/messages
    GET  /api/runs/{run_id}
    GET  /api/runs/{run_id}/events

### 5.1 提交消息

请求：

    {
      "client_message_id": "message-001",
      "content": "帮我找今天重要的任务"
    }

成功返回 202：

    {
      "run_id": "run-123",
      "status": "queued",
      "created_at": "2026-10-02T08:00:00Z",
      "replayed": false
    }

消息和 run 在同一数据库事务中创建。重复提交同一 client_message_id 且正文一致时返回原 run；正文不同返回 409 IDEMPOTENCY_CONFLICT。

### 5.2 当前 Agent 输入

当前 runtime 会装配：

- 固定系统提示词；
- 当前对话的消息历史；
- 当前用户本轮消息；
- 当前账号内部 user_id；
- search_tasks / get_task 工具 schema；
- 工具查询返回的任务数据。

当前系统提示词明确要求：

- 只能回答用户问题；
- 必要时调用只读任务工具；
- 不能创建、修改、完成或删除任务；
- 信息不足时先追问；
- 不使用其他对话或未提供的个人信息；
- 不输出思维过程。

### 5.3 当前 Agent 输出

当前模型输出被累积为普通文本，并通过 message.delta、run.completed、run.failed 等事件发送。当前没有 task_draft、report_draft、check_in_draft、advice 或 clarification 的后端 Pydantic schema，也没有针对这些类型的 API 校验。

### 5.4 当前工具

当前只注册两个 Tool：

    search_tasks(filters, limit, cursor)
    get_task(task_id)

当前工具的特点：

- schema 使用 additionalProperties: false；
- 参数中没有 user_id；
- Application 层注入当前账号范围；
- 只读，不产生任务写入；
- 任务字段使用布尔型 important、urgent；
- 任务状态为 open、completed。

## 6. 当前代码与产品协议的差距

| 差距项 | 产品设计要求 | 当前实现 | 交接判断 |
|---|---|---|---|
| Agent 入口 | 按 mode 生成结构化结果 | 对话消息异步 run | 可复用 run，但需增加业务模式/输出协议 |
| 任务输入 | 任务及其业务上下文 | 只读任务 | 已有基础，需要扩展字段或上下文查询 |
| 任务报告输入 | 近期报告 | 无表、无接口 | 新增数据模型和查询用例 |
| check-in 输入 | 近期状态 | 无表、无接口 | 新增数据模型和查询用例 |
| Agent 输出 | 结构化五类结果 | 普通文本 | 新增 schema、校验和事件载荷 |
| Agent 任务草稿 | 可转为 proposal | Agent 禁止写入且不生成 proposal | 连接 Agent 输出与现有 proposal 用例 |
| Agent 报告草稿 | 用户确认后保存 | 不存在 | 新增确认/保存边界 |
| Agent check-in 草稿 | 用户确认后保存 | 不存在 | 新增确认/保存边界 |
| Agent 建议 | 基于任务/报告/check-in | 只能根据任务回答 | 扩展上下文装配和建议 schema |
| 语音输入 | 前端本地转写、后端校准和业务核验，文字可编辑 | 本地转写和文字校准接口均未实现 | 阶段 6 实现；默认无音频上传，草稿不创建消息/run |
| 任务字段 | 重要度/紧急度 0–10，带原因 | bool important/urgent | 需要产品确认迁移或兼容策略 |

## 7. 建议的目标接口形态

本节是交接建议，不代表已获确认的实现方案。

建议保留现有 run/SSE 可靠执行机制，并在其上增加产品级请求模式，而不是并行建设第二套 Agent runtime。

逻辑接口可以是：

    POST /api/conversations/{conversation_id}/agent-turns

请求建议：

    {
      "client_request_id": "agent-turn-001",
      "mode": "task_capture",
      "text": "明天下午三点交项目周报，很重要",
      "timezone": "Asia/Shanghai"
    }

或继续复用当前：

    POST /api/conversations/{conversation_id}/messages

由消息内容和对话状态触发 Agent 模式。两种方案需要产品确认，不能同时无差别暴露两套入口。

建议继续使用当前两阶段 run：

    POST 接受请求 → 返回 run_id
    GET run status → 查询结构化最终结果
    GET run events → SSE 获取状态和可见增量

最终结果可以增加：

    {
      "result_type": "task_draft",
      "result": {
        "operation": "create",
        "task": { "...": "..." },
        "requires_confirmation": true
      }
    }

需要明确：

- SSE 增量是否只发送可见文本，还是支持结构化 JSON patch；
- GET /api/runs/{run_id} 是否同时返回结构化 Agent result；
- 模型输出不符合 schema 时是否自动重试一次；
- 结构化结果是否持久化在 run 表，还是只保存最终助手消息和提案。

## 8. Agent 输出到业务写入的数据流

### 8.1 任务草稿

    用户文本/转写文本
      ↓
    Agent task_capture
      ↓
    task_draft
      ↓ 前端展示并等待点击确认
    POST /api/proposals
      ↓
    GET /api/proposals/{proposal_id}
      ↓ 用户确认
    POST /api/proposals/{proposal_id}/confirm
      ↓
    tasks 写入

Agent 不应直接调用 TaskService.confirm，也不应把模型生成的结构化 JSON 直接写成任务。

### 8.2 任务报告

    用户描述完成情况
      ↓
    Agent task_report
      ↓
    report_draft
      ↓ 用户确认
    POST /api/tasks/{task_id}/reports
      ↓
    task_reports 写入

如果 outcome=done 是否同时把任务状态改为 completed，需要产品确认。建议使用一个 Application 用例定义清晰事务边界，避免报告已写入但任务状态未更新，或反过来的部分成功。

### 8.3 check-in

    用户主动描述状态
      ↓
    Agent check_in
      ↓
    check_in_draft
      ↓ 用户确认
    POST /api/check-ins
      ↓
    check_ins 写入

如果用户直接填写滑杆而不经过 Agent，可以直接调用 POST /api/check-ins；Agent 只是语音/自然语言输入的整理器。

### 8.4 建议

    用户询问下一步
      ↓
    Agent advice
      ↓ Application 读取近期 tasks/reports/check_ins
      ↓
    advice + ranked_tasks + next_step + reason
      ↓
    前端展示

建议默认不写数据库。如果建议包含修改任务，应转化为任务 proposal，由用户确认后执行。

## 9. 需要产品确认的问题

### 9.1 Agent 入口

1. 是否新增 /api/agent/turn，还是复用现有 conversation message API？
2. task_capture 等 mode 是前端显式传入，还是由 Agent 根据普通文本自动判断？
3. 用户主动发送后的语音文字是否总走同一个 Agent turn？草稿校准本身不创建 turn。
4. Agent turn 是否必须绑定 conversation_id？产品文档当前同时强调业务记录和 Agent 建议，但没有完全冻结是否所有建议都进入对话历史。

### 9.2 结构化输出

1. 顶层字段使用 type 还是 result_type？
2. 草稿是否必须统一带 proposal_id，还是先返回 Agent draft，再由前端调用 /api/proposals？
3. advice 是否允许同时返回多个推荐任务？附件示例使用 ranked_tasks，但“推荐一个下一步”更接近单个首选项。
4. clarification 是否允许多个问题，还是每轮只返回一个问题？
5. Agent 输出 schema 校验失败时，是返回 MODEL_OUTPUT_INVALID，还是允许一次模型修复请求？
6. 是否保存结构化 Agent 结果，还是仅保存可见助手文本？

### 9.3 任务模型

1. 当前 important/urgent boolean 是否迁移为 importance/urgency numeric(3,1)？
2. 是否保留现有布尔字段兼容前端，还是一次性替换？
3. importance_reason、urgency_reason 是任务事实，还是每次 Agent 建议的解释？
4. 任务报告 done 是否自动完成任务？
5. partial、blocked 报告是否修改任务状态，还是只增加历史记录？
6. minutes_spent 是否允许 0，是否有最大值？

### 9.4 状态数据

1. mood、energy、stress 是否全部可空？
2. check-in 是否需要 client_request_id 做幂等？
3. 是否允许一天多次记录？附件设计是允许的。
4. 是否允许用户编辑或删除历史 check-in/report？
5. 建议读取多久的近期数据？例如最近 7 天、最近 20 条，还是按时间和数量双重限制？
6. 建议是否需要落库供用户回看？附件当前倾向不增加 recommendation history。

### 9.5 隐私与安全

1. 阶段 6 需冻结本地模型、浏览器兼容性、可选音频回退格式、低置信度阈值、隐私告知与临时音频保留/清理；默认不上传音频。
2. MiMo 上游是否收到任务报告和 check-in 内容，产品如何告知用户？
3. 日志是否允许保存 Agent mode、结果类型和 token 用量，但禁止保存正文？
4. 用户删除对话时，Agent 运行上下文和结构化结果如何清理？
5. 删除任务后，历史 task_report 是否保留、级联删除还是匿名化？

## 10. 实施分层建议

建议按以下顺序拆分，避免一次改动同时改变数据库、Agent runtime 和前端协议：

### 第一步：冻结产品契约

- 冻结 Agent mode、响应类型和字段；
- 冻结任务评分字段是否替代布尔字段；
- 冻结报告与 check-in 的确认和删除语义；
- 冻结 Agent 是否绑定 conversation；
- 冻结结构化结果的持久化方式。

### 第二步：先增加纯 schema 和领域规则

- 新增 Pydantic Agent result schema；
- 对 task_draft/report_draft/check_in_draft/advice/clarification 做严格校验；
- 添加分数、报告 outcome、check-in 范围规则；
- 不接真实模型写入，不改变当前任务行为。

### 第三步：增加业务事实表和 Application 用例

- task_reports；
- check_ins；
- 账号归属、幂等、分页和删除边界；
- 完成报告与任务状态的事务规则。

### 第四步：扩展 Agent 输入和 Tool

- 只读读取近期任务报告；
- 只读读取近期 check-in；
- 按 mode 装配最小上下文；
- 限制查询数量、时间范围和 token。

### 第五步：把结构化输出接入 run/SSE

- 保留现有 run、worker、lease、SSE、重连机制；
- 增加结构化结果保存和读取；
- 模型输出先 schema 校验，再向前端发送；
- 不把模型 Tool call 视为用户授权。

### 第六步：接入确认写入

- task_draft 转换为现有任务 proposal；
- report_draft 转换为任务报告确认流程；
- check_in_draft 转换为 check-in 确认流程；
- 确认后以真实数据库回执作为成功依据。

### 第七步：接本地转写与文字核验

- 前端录音并本地转写；默认只提交初步文字，不上传原始音频；
- 后端校准格式与日期/时间，检查完整性、任务意图、归属和业务规则，返回可编辑文字或澄清；
- 用户明确发送后才创建对话消息或 Agent Run；所有任务写入仍经待确认提案与用户确认；
- 仅低置信度、用户主动重试或后端无法判断时提供可选音频上传/二次转写，临时音频按阶段 6 策略清理。

## 11. 验收清单

### 输入隔离

- [ ] Agent 不能读取其他账号的任务、报告、check-in。
- [ ] Tool schema 不含 user_id。
- [ ] 其他对话不会自动进入当前 Agent 上下文。
- [ ] 建议只使用当前用户明确提供或数据库中已保存的事实。
- [ ] Agent 不从音频特征推断心情、压力或诊断结果。

### 输出协议

- [ ] 每个结果有稳定的 type/result_type。
- [ ] 草稿字段通过服务端 schema 校验。
- [ ] 无法识别目标任务时返回澄清，不猜测 ID。
- [ ] 建议包含真实任务 ID 和可解释依据。
- [ ] requires_confirmation 与实际写入边界一致。
- [ ] 非法模型输出不会写入业务表。

### 确认与事务

- [ ] Agent 草稿未经用户确认不会创建或修改任务。
- [ ] 重复确认不会重复写入。
- [ ] 并发版本变化返回冲突，不静默覆盖。
- [ ] 任务报告与任务状态变更的事务边界明确。
- [ ] check-in/report 重试不会重复创建记录。

### 运行与恢复

- [ ] 用户消息和 run 创建保持原子性。
- [ ] worker 重启后 run 收敛到明确状态。
- [ ] SSE 断线可通过序号恢复。
- [ ] 结构化结果在 SSE 断线后仍可通过 run status 读取。
- [ ] 模型失败保留用户消息，不伪造成功回执。

## 12. 交接状态

### 已有能力，可直接复用

- 服务端 Cookie 会话和账号隔离；
- 任务查询 Application 用例；
- 现有任务 proposal/confirm/cancel 用例；
- 对话和消息持久化；
- Agent run、worker lease 和失败收敛；
- MiMo OpenAI 兼容客户端；
- SSE 持久事件、Last-Event-ID、过期游标 snapshot；
- 账号/IP/全局限流；
- 当前只读任务 Tool 的 schema 和归属校验。

### 当前缺口

- task_reports 表和接口；
- check_ins 表和接口；
- Agent mode 请求协议；
- 五类结构化 Agent result schema；
- Agent 结果到 proposal/业务写入的转换；
- 前端本地转写与后端文字校准接口；可选音频回退尚未冻结；
- 重要度/紧急度从布尔值到评分的迁移或兼容策略；
- 结构化 Agent 结果的持久化和 SSE 传输规则。

### 本次不应顺带实现

- 跨对话长期记忆；
- 自动情绪识别或心理诊断；
- 原始音频历史库；
- 推荐训练管线；
- 多 Agent 或任意外部 Tool；
- 训练、提醒、通知和向量检索。

## 13. 最终交接判断

当前后端并非缺少 Agent 运行基础，而是处在“通用对话式只读 Agent”阶段。产品设计要求的 Agent 已经定义了输入数据和输出协议，但这些协议还没有落入当前 presentation、application、domain、infrastructure 和测试层。

后续实现的主线应是：

    冻结产品 Agent schema
      → 增加 task_reports/check_ins
      → 扩展 Agent 只读上下文
      → 输出结构化草稿/建议
      → 接入统一确认用例
      → 用数据库回执结束一次业务操作

在用户确认上述未决问题前，不应直接把附件中的字段和接口作为最终数据库迁移或公开 API。
