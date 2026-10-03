# 拾序后端分阶段开发计划（已确认，阶段 5 已验收，阶段 6 待用户验收）

> 2026-10-02 用户已确认总计划与阶段 1–5；阶段 6 后端实现和验证完成，待用户验收。每次仅实施一个阶段，不推进阶段 7。


## 1. 范围与现状

**已确认产品范围**：Web；用户名密码与开放注册；同账号跨设备共享；无首期自助密码找回；后端从空数据开始保存任务与多个对话；支持分别手动删除任务、对话；无跨对话长期记忆；单 Agent、单 LLM；**所有任务写入（包括手动创建、编辑、完成、删除）都二次确认**；HTTPS 与调用限额；前端保留经典 5×5 舒尔特表，取消眼动，后端不提供训练 API。2026-10-02 确认技术基线为 Python/FastAPI、PostgreSQL、SQLAlchemy/Alembic、服务端 Cookie 会话；任务永久删除。语音现按 [ADR 0004](./adr-0004-local-voice.md) 由前端本地转写、后端校准和业务核验；默认不上传音频，用户手动发送。后端未来部署在阿里云服务器；LLM 密钥通过环境变量配置。独立仓库位于现有 `D:\proj\heiks\backend`。

**当前资料**：五份设计文档为 [产品简报](./product-brief.md)、[接口契约](./api-contract.md)、[后端架构](./backend-architecture.md)、[Agent 架构](./agent-architecture.md)、[系统架构](./system-architecture.md)。阶段 0 将 `D:\proj\heiks\backend` 初始化为独立 Git 仓库并加入契约骨架。xihack 目前以 `localStorage` 存演示任务，`due` 是展示字符串、`done` 是布尔值；没有账号、真实对话或后端 API 接入。其旧 `/api/interpret`、`/api/transcribe` 计划不再是当前接口基线。laoshiren 是只读工程参考，不能把其 Huawei/Bearer 认证、LangGraph、Redis、向量检索、长期记忆、文件、调度和通知系统移植过来。

**阶段 0 文档同步范围**：历史记录保留；语音流程由 ADR 0004 修订，阶段 6 参数由 [ADR 0005](./adr-0005-speech-stage-6.md) 冻结。

## 2. 实施原则与阶段关口

1. 独立仓库负责后端代码、迁移、自动化验证和 API 契约；不写入 xihack，不导入其旧 localStorage 数据。前端联调以新契约、样例请求和测试实例交接。
2. 每阶段先复核其入口决策；阶段内实现、测试并形成验收记录；交付后停止，等用户确认再推进。未决项不能被实现时的默认值悄悄变成产品决定。
3. 认证账号由服务器会话解析；所有任务、对话、消息、提案和 run 查询均限定账号。**已确认由后端强制二次确认**：手动与 Agent 发起的任务变更都先保存可展示的待确认意图；只有确认接口能真正修改任务，并再次检查归属、版本、过期和幂等。两种来源共用同一确认用例，具体 API 在阶段 0 冻结。
4. PostgreSQL 保存产品事实、run 状态和可重放事件。SSE 是呈现通道；断线不等于取消 run。首期只用单 Agent、单 LLM；不为将来可能的能力预装 Redis、LangGraph 或微服务。
5. 测试选择真实风险：账号隔离、重复请求、并发版本冲突、worker 崩溃/重启、SSE 重连、删除竞争、模型异常、音频超限。每阶段保存可复现的执行命令与结果。

## 3. 阶段安排

| 阶段 | 入口依赖 | 交付物 | 验收标准 | 主要风险和关口 |
|---|---|---|---|---|
| **0. 契约框架与独立仓库基线** | 用户确认本计划；已确认的产品/架构边界完整记录 | 在 `D:\proj\heiks\backend` 初始化独立仓库并保留五份文档、同步新决定；ADR/决策表；版本化 OpenAPI 框架、错误码、任务 DTO、服务端强制的统一二次确认、对话/run/SSE/提案/语音 schema；项目骨架、依赖锁定、配置样例、测试/静态检查与迁移入口；未冻结的阶段参数显式标注 | 仓库与 xihack Git 边界独立；文档不再写“任务软删除/语音待定/手动任务直接写入”；确认接口以外无任务写入口；核心端点、身份字段、状态码和示例可契约校验；空数据库迁移可升级；无业务实现越界 | 对尚未决定的会话期限、上传限制等只标注阶段关口，不写成默认产品规则 |
| **1. 身份与基础持久化** | 阶段 0；用户名/密码与会话规则冻结；本地 PostgreSQL 可用 | users/sessions 迁移；注册、登录、当前用户、退出；Argon2id 哈希；可撤销随机会话 Cookie；CSRF/来源校验；最小化日志与认证限流 | 新用户注册登录退出；跨设备各自登录可识别同账号；退出立即失效当前会话；未登录与跨账号访问失败；错误不泄漏密码或凭证；基础安全与迁移测试通过 | 开放注册滥用、账号枚举、Cookie/CSRF 配置；会话寿命与限流值需先定 |
| **2. 任务与明确偏好** | 阶段 1；任务字段、日期精度、统一二次确认协议和永久删除语义冻结 | tasks/必要偏好及待确认意图迁移；任务读取、筛选与分页；手动创建/编辑/完成/删除先由后端保存预览意图，再由确认入口真正写入；重要/紧急独立字段；版本冲突、幂等键；永久删除及相关提案失效规则；OpenAPI 样例 | 新账号列表为空；同账号两设备读写一致；另一账号看不到/改不了任务；绕过确认接口不能写任务；未二次确认时任务表不变；重复确认不重复创建；过期版本不能静默覆盖；确认删除后任务 API 不再返回且不能恢复 | 永久删除与备份、已生成提案、对话历史中的任务引用如何处理需事先明确；偏好仅实现已确认的最小字段 |
| **3. 多对话与历史** | 阶段 1、2 已验收；冻结消息分页与删除边界 | conversations/messages 迁移；创建、列表、查看历史、改标题、手动删除；账号隔离；稳定 keyset 分页；同账号创建请求幂等；消息级联清理但不关联任务 | 同账号跨设备看到相同历史；新对话为空；删除一段对话不删任务；跨账号 ID 返回不可枚举结果；分页无重复遗漏；创建重试不重复建对话；删除与数据库消息插入竞争后不留下孤立/复活消息；迁移升级回退与模型检查通过 | 当前阶段以 PostgreSQL 外键/级联测试父子写删竞争；消息 HTTP 写入与 Agent run 的并发取消/恢复在阶段 4 验收 |
| **4. 可恢复的 Agent 只读问答** | 阶段 2、3 已验收；MiMo 模型与应用限额、SSE schema/保留窗、运行取消策略已冻结；需有可验证的测试凭证 | 消息提交创建 run；PostgreSQL run/事件表；同一代码包的 worker 入口、领取/超时/恢复；单模型适配器；仅 `search_tasks`/`get_task` 只读工具；run 状态与 SSE 重连；可见回复持久化 | 用户消息与 run 原子持久化；模型失败仍保留用户消息；当前对话问答仅使用本对话与当前账号任务；SSE 断线重连不重复生成；worker 重启后 run 明确收敛；Tool 无法越权或写任务；无内部推理泄露 | PostgreSQL 领取/lease 的复杂度应按单节点规模最小实现；上游限流、上下文大小、事件保留与删除竞态需测；美元预算在阶段 7 配置 |
| **5. Agent 写入提案接入** | 阶段 4；提案有效期与冲突规则冻结 | create/update/complete/delete 结构化提案；Agent 复用阶段 2 的统一确认/取消用例；归属、版本、过期、幂等及已删除目标校验；Agent 行为评测集 | 模型生成、格式错误、重放或未经点击确认均不能写任务；确认一次只提交一次；跨账号/过期/旧版本/已删除目标提案被拒；真实数据库回执才向用户报告成功；查询类请求仍无需确认 | 必须测试双击确认、并发编辑、删除与确认同时发生；自然语言歧义应追问而非猜测写入 |
| **6. 语音转写与草稿** | 阶段 1、3；模型、浏览器、回退格式/阈值/保留与限额按 ADR 0005 冻结 | 前端本地转写结果的后端同步校准与可编辑草稿契约；日期时间、完整性、任务意图与安全业务核验；用户明确同意的可选本地音频二次转写；不复用 Agent run | 默认不上传原始音频；合法初步文字返回可编辑草稿或澄清；用户未主动发送时不生成消息/run；任务写入仍须提案确认；回退超限、损坏及模型故障有明确错误；音频只在内存中处理；隐私与限额通过测试 | 真实浏览器/设备和领域词准确率待联调；不实现实时边说边转写 |
| **7. HTTPS 演示与交接** | 阶段 1–6 验收；域名/主机、预算、数据地域、备份与前端对接责任已确认 | 阿里云服务器上的 HTTPS 反向代理与运行配置、密钥注入、应用/账号/IP/全局限额、LLM 项目预算、DB 备份和恢复演练、健康监控、发布/回滚说明、前端联调契约和样例 | HTTPS 可用且 Cookie/CSRF 在真实 origin 下通过；用两个设备/账号的 API 客户端完成后端端到端验收；上游/本地限流可见且超额停止调用；恢复演练成功；日志无凭证/正文；前端负责人可按文档接入；无训练 API | 完整 Web 页面验收依赖 xihack 负责人另行接入，此计划不改 xihack；平台硬预算与应用侧限额要同时配置，数值和责任人由用户确认 |

**依赖路径**：0 → 1 → 2/3 → 4 → 5；阶段 6 的文字校准依赖 1/3，完整语音任务写入还依赖阶段 5 的 Agent 提案；7 在前序阶段完成后进行。实际执行保持严格单阶段，不并行提交多个阶段。

**阶段 3 分页与写入约定**：对话列表按不可变的 `created_at DESC, conversation_id DESC` keyset 排序；消息按 `created_at ASC, message_id ASC` keyset 排序。创建请求使用账号内 `client_request_id` 与请求指纹做幂等；删除及改标题校验 Origin/CSRF。消息写接口随 Agent run 在阶段 4 实施。

**阶段 4 执行约定（2026-10-02 用户确认）**：单一供应商为小米 MiMo OpenAI 兼容 API，模型 `mimo-v2.6-flash`。每 run 最多 16 次模型请求、16 次只读 Tool 调用、180 秒、累计 64K 输入/8K 输出 tokens；每账号 10 次/小时且最多 2 个并发 run，每 IP 30 次/小时，全局 10 次/分钟。金额硬预算由部署阶段在供应商控制台配置。SSE 使用持久单调序号及 `Last-Event-ID`，事件保留 7 天；过期游标以状态快照恢复。连接断开不取消 run；删除对话时级联清理 run/events，worker 写入前锁定并复核对话。测试使用假 provider 覆盖集成行为，阶段验收前执行一次使用合成短提示的真实模型 smoke test；不发送用户正文。

**每阶段汇报模板**：变更文件/迁移、对应需求、自动化与人工验证（含命令和结果）、未通过项、数据/安全/部署风险、下一阶段入口决策。每次汇报后等待用户明确确认。

## 4. 技术核对：采用与不照搬

| 依据 | 适合拾序的做法 | 不照搬/边界 |
|---|---|---|
| [FastAPI 官方安全教程](https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/)、[OWASP 密码存储](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)、[会话管理](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)、[CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) | Argon2id、服务端可撤销 Cookie 会话、来源与 CSRF 校验；凭证不进 localStorage | FastAPI 教程的 JWT Bearer 是示例，不替换已确认的 Cookie 基线；SameSite 单独不能完成 CSRF 防护 |
| [SQLAlchemy Session](https://docs.sqlalchemy.org/en/20/orm/session_basics.html)、[Alembic](https://alembic.sqlalchemy.org/en/latest/tutorial.html)、[PostgreSQL 锁定查询](https://www.postgresql.org/docs/current/sql-select.html) | 每个请求/worker task 独立事务；版本化迁移；多 worker 时可用 `SKIP LOCKED` 领取待处理 run | 不共享 AsyncSession；`SKIP LOCKED` 适用于队列式领取，不用于一般任务列表；首期不复制 laoshiren 的通用 durable job 平台 |
| [MDN SSE](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)、[OpenAI Function Calling](https://developers.openai.com/api/docs/guides/function-calling)、[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) | POST 接受消息、GET SSE 看事件；严格 Tool schema 与应用侧权限/版本校验 | 不把流连接当作 run 的持久状态；结构化输出不等于用户授权；不引入 LangGraph/多 Agent |
| [OpenAI 生产建议](https://developers.openai.com/api/docs/guides/production-best-practices)、[限流](https://developers.openai.com/api/docs/guides/rate-limits)、[数据控制](https://developers.openai.com/api/docs/guides/your-data) | 后端 Secret、项目硬消费限制与应用侧每账号/全局额度；明确向用户告知供应商数据处理边界 | 删除本地数据不代表供应商侧监控数据立即消失；不能只靠 OpenAI 上游限流代替产品限额 |
| [FastAPI full-stack 模板](https://github.com/fastapi/full-stack-fastapi-template)、[Open WebUI 聊天持久化](https://github.com/open-webui/open-webui/blob/main/backend/open_webui/models/chats.py)、[Dify 对话生成](https://github.com/langgenius/dify/blob/main/api/core/app/apps/advanced_chat/app_generator.py) | 参考分层、数据库持久化、契约与测试组织方式，以及持久对话和异步生成的边界 | 不套用整站模板的前端/JWT/部署组合；不移植 Open WebUI/Dify 的多模型、权限平台、工作流或 RAG |
| 本地 `D:\proj\laoshiren` 架构、Agent Runtime、Tool/Policy 与实现 | 借鉴 Application 写入口、Tool 账号范围、版本/幂等、run/事件恢复及分阶段验收 | 不复制 Huawei 登录、Bearer Token、Personal State/Memory、LangGraph、Redis、pgvector、通知、调度、文件体系 |

## 5. 尚需用户确认的事项

### 已确认的阶段 0 输入

1. 后端强制二次确认已明确：服务端保存待确认意图，确认接口是唯一任务写入口。具体字段和过期策略在阶段 0/2 之间冻结。
2. 后端仓库目录已明确为 `D:\proj\heiks\backend`，保留五份文档；若已有远端地址或仓库命名要求，阶段 0 前提供。无远端时可先建立本地独立仓库。
3. 语音交互已由 ADR 0004 更新为前端本地转写、后端校准和业务核验、用户手动发送；阶段 6 冻结模型、兼容性、回退格式、阈值及隐私/保留策略。

### 已确认的阶段 1 输入

用户授权采用推荐的身份规则，详见 [ADR 0002](./adr-0002-identity.md)。阶段 1 仅实现身份、会话与基础限流；后端未来部署在阿里云服务器，LLM 供应商/密钥暂缓。

### 已确认的阶段 2 输入

用户已确认任务字段、日期精度、15 分钟统一确认和当前数据库永久删除规则，详见 [ADR 0003](./adr-0003-tasks-confirmation.md)。本阶段先完成契约与纯规则，再做数据库与接口；数据库验收通过前不标记阶段 2 完成。

### 阶段 1 交接（2026-10-02）

- 已交付 users/sessions/限流迁移、注册/登录/当前用户/退出及 CSRF 接口、Argon2id、服务端可撤销会话、精确 Origin 和数据库限流；实际接口快照在 `contracts/openapi.json`。账号归属由 Cookie 解析，当前阶段尚无任务/对话数据接口。
- 在专用 `shixu_test` PostgreSQL 上执行 `alembic upgrade head`、`alembic downgrade base`、再执行 `alembic upgrade head`，均通过；`alembic check` 无模型差异。以 `TEST_DATABASE_URL` 指向该测试库执行 `python -m pytest -p no:cacheprovider -q`：11 passed；`ruff check .` 与 `git diff --check` 通过。
- 留存风险：反向代理后的可信客户端 IP、公开注册滥用监测、限流旧窗口清理和生产 Secret 注入属于部署阶段；测试仅验证身份接口的账号归属，任务/对话跨账号授权随其对应阶段实施。

### 阶段 2 交接（2026-10-02）

- 已交付任务与待确认提案迁移、账号限定列表/详情与筛选分页、手动提案预览、确认/取消用例；创建、更新、完成、删除仅在确认事务中写任务。日期保留仅日期或分钟精度和 IANA 时区；未新增尚无需求支撑的偏好表。实际接口快照见 `contracts/openapi.json`，决策见 ADR 0003。
- 阶段验收复核（2026-10-02）：专用 `shixu_test` PostgreSQL 已执行 `alembic upgrade head`、`alembic current`、`alembic downgrade 0002_identity_sessions`、再次 `alembic upgrade head`，`alembic check` 无差异；`uv run pytest -p no:cacheprovider -q` 为 `20 passed`；`uv run ruff check .` 和 `uv run ruff format --check .` 通过。期间修正了 `src/assistant_backend/application/tasks.py` 的 Ruff 格式差异。阶段 2 验收通过。
- 验收范围包括空列表、同账号双设备、跨账号拒绝、未确认不写任务、创建/确认幂等、版本冲突、过期/取消、删除后不可查询及提案失效、失败回滚和分页。数据库并发竞争尚未以多连接压力测试覆盖，留作后续强化；备份保留与恢复目标到部署阶段确认，任务删除后的历史对话文字留到对话阶段决定。

### 阶段 3 交接（2026-10-02）

- 新增 `0004_conversations_messages` 迁移和 SQLAlchemy 模型。对话账号归属、同账号 `client_request_id` 唯一约束、消息角色/正文约束、复合排序索引均在数据库维护；删除对话级联清理消息，不与任务建立外键。
- 新增 Application DTO 与用例、Domain 标题规则、Presentation 请求/响应 schema 与 FastAPI 路由。支持创建、稳定分页列表、读取消息历史、改标题、永久删除；创建重试幂等，内容不同时返回 409。所有对象查询附加当前会话 user_id；跨账号对象统一返回 404。阶段 3 未包含消息发送；消息发送 API 和 Agent run 已在阶段 4 交付。
- 数据库：`uv run alembic upgrade head`、`uv run alembic current`（`0004_conversations_messages (head)`）、`uv run alembic downgrade 0003_tasks_proposals`、再次 `upgrade head`、`uv run alembic check` 全部通过。测试库为专用临时 `shixu_test`，执行完已停止并移除 compose 容器。
- 测试：`uv run pytest -p no:cacheprovider -q`：23 passed；含多设备可见性、账号隔离、分页、创建幂等、任务保留与真实 PostgreSQL 外键锁竞争。`uv run ruff check .`、`uv run ruff format --check .`、`git diff --check` 均通过。
- 剩余风险/后续：阶段 4 实现消息写入与 Agent run 后，必须再次覆盖“删除对话与 run/assistant 回复落库、取消/恢复”竞态；当前测试证明数据库父子关系不会留下孤立或复活消息。测试输出有一条 Starlette 对 httpx TestClient 的弃用警告，不影响通过结果。

### 阶段 4 交接（实现与自动化验证完成，待凭证验证及用户验收）

- 用户确认进入阶段 4，阶段 3 交付作为已接受入口。
- 已冻结：MiMo `mimo-v2.6-flash`；16 次模型请求/16 次只读工具调用/180 秒/64K 输入与 8K 输出 tokens；每账号 10 次/小时且最多 2 并发、每 IP 30 次/小时、全局 10 次/分钟；SSE 持久序号及 7 天事件保留；过期游标快照；SSE 断开不取消；真实模型仅一次合成短提示 smoke test。
- 一次合成短提示真实模型 smoke test 被上游拒绝；适配层仅记录脱敏错误码，未留存原始 HTTP 状态或正文，也未重试。需在小米控制台核对/轮换凭证，并仅在本地 `.env` 更新后重新执行一次合成 smoke test。
- 已交付 `0005_agent_runs_events`、run/message 提交与幂等、只读 Agent/worker、MiMo 适配器、GET/SSE 接口及 OpenAPI 契约。专用 PostgreSQL 全量迁移升级/回退/模型检查通过；全套 pytest 为 35 passed；Ruff 检查与格式检查通过。实际凭证验证是阶段验收的唯一未决项。

### 阶段 5 交接（Agent 任务提案接入，已验收）

- 用户明确决定跳过阶段 4 真实 MiMo 凭证 smoke test，继续实施阶段 5；该 smoke test 的 `MODEL_AUTH_FAILED` 保留为已知上游凭证风险，不改变阶段 5 的本地假 provider 验收范围。
- Agent runtime 新增 `propose_create_task`、`propose_update_task`、`propose_complete_task`、`propose_delete_task` 四个受限 Tool。Tool 只调用现有 `TaskService.create_proposal` 保存 `source=agent` 的 pending proposal，不直接写任务。
- Agent 生成的 proposal 使用 `run_id + tool_call_id` 形成账号内幂等请求 ID；确认、过期、版本冲突、跨账号和删除失效仍由阶段 2 的统一 proposal/confirm 用例处理。
- 新增集成测试证明：Agent 生成提案后任务仍为空，只有调用现有确认 API 后才写入任务。阶段 5 未实现 task_reports、check_ins、语音、数值化重要度或其他交接文档中尚未冻结的扩展。

### 阶段 6 执行约定（2026-10-02 用户授权按推荐方案）

- 用户已确认阶段 5 验收并授权阶段 6。语音参数按 [ADR 0005](./adr-0005-speech-stage-6.md) 冻结：浏览器端 Whisper base 多语种；首发桌面 Chrome/Edge WebGPU；0.55 低置信度提示；可选回退 16 kHz/单声道/16-bit PCM WAV，20 秒、1 MiB；仅用户明确触发，内存处理后释放；服务器本地预置 Whisper base 多语种模型。
- 阶段 6 后端接口为同步文字校准与可选音频回退；不保存草稿、不创建消息/run。回退限每账号 5 次/日、每 IP 20 次/日、全局 10 次/分钟。前端仓库只读，本阶段不实施浏览器录音 UI。
- 验收需验证合法文本日期标准化与澄清、恶意/超限音频拒绝、认证与同意、账号限流、失败不落盘、未主动发送时无消息/run，任务确认边界保持不变；接口快照和全套测试通过后交接。

### 阶段 6 后端验收交接（2026-10-02，待用户确认）

- 已交付同步文字校准与可选音频回退接口、OpenAPI 快照、音频格式/大小/时长校验、同意与登录/CSRF/Origin 检查、持久限额、内存处理、本地预置模型推理及 60 秒进程级超时。草稿不落盘，不创建消息/run；任务写入仍由提案确认接口负责。
- 验收：文字日期标准化与澄清、恶意及超限音频拒绝、认证/同意、账号限流、失败不落盘、未发送时无消息/run、任务确认边界、接口快照均通过自动测试。`uv run --extra speech pytest -p no:cacheprovider -q` 为 41 passed；`uv run --extra speech ruff check .` 与 `uv run --extra speech ruff format --check .` 通过。专用可丢弃 PostgreSQL 执行 `alembic downgrade 0004_conversations_messages`、`upgrade head`、`current` 和 `check`，回到 `0005_agent_runs_events (head)` 且无模型差异。
- 真实后端回退检查：在仓库外预置 `Systran/faster-whisper-base` CTranslate2 文件，并用 Windows 中文语音合成的 16 kHz 单声道 PCM WAV 直调音频接口；返回 200，识别“提醒我明天交周报”，草稿意图为 `create`、日期为次日；调用前后消息、run、提案和任务行数一致。另以极短超时实际触发 `TRANSCRIPTION_TIMEOUT` 503；单元测试验证超时终止子进程。模型和 WAV 样本均未入库。
- 未验证：真实浏览器/麦克风与前端联调、真人口音及领域词准确率、目标部署机上的模型加载性能。每次回退会启动并加载一个本地模型进程，部署时需按并发和内存实测容量。阶段 7 等待用户另行确认。

### Agent 体验补充阶段（2026-10-03，用户已授权实施）

- 用户要求基于已验收的 Agent 写入提案能力，改进回答格式、多任务创建耗时和运行进度/审核交互，并明确回复“按计划开发”。此为阶段 5 的受限补充，不代表用户已验收阶段 6，也不授权阶段 7。
- 范围：单次最多 10 项的 Agent 创建提案批次；批次持久化、幂等、完整账号授权、pending/expiry 检查及一事务全有或全无确认；用户可在确认前编辑/移除单项，移除后可确认剩余项；旧单提案 API 继续可用；基于现有持久 SSE 事件流展示真实进度；安全 Markdown 与工具调用防洪。
- 不改变语音草稿手动发送；不允许 Agent 直接写任务；不向前端发送 reasoning_content、CoT、工具参数或内部堆栈；不另建实时协议、不做任意多线程执行。
- API/data/测试规范与交接记录补充至 [api-contract.md](./api-contract.md) 与 [agent-architecture.md](./agent-architecture.md)。本补充阶段验收后停下等待用户确认。

### 相应阶段开始前再冻结

- **身份**：用户名、密码、会话期限、基础限流和首发年龄范围已在 [ADR 0002](./adr-0002-identity.md) 冻结；多设备会话管理界面留待后续决定。
- **任务/对话**：阶段 2 的任务字段、日期语义、提案引用与当前数据库永久删除已按 ADR 0003 冻结；备份保留期限仍待部署阶段确认。阶段 3 已冻结对话消息分页与删除边界；阶段 4 已实现删除时级联清理运行及事件、worker 写入前复核对话。任务被删除后历史对话中的文字仍保留。手动任务写入也必须二次确认，不开放直接写入口。
- **Agent/runtime**：MiMo `mimo-v2.6-flash`、阶段 4 的 run/账号/IP/全局限额及 SSE/断开规则已冻结；Agent 提案复用阶段 2 的确认与冲突规则；部署美元预算留阶段 7；超长对话是否启用摘要仍待后续决定。
- **语音（阶段 6）**：参数见 ADR 0005；真实浏览器性能、中文领域词准确率和前端联调仍需验证。
- **部署**：域名与前后端同源方案、阿里云服务器规格/数据地域、LLM 项目预算和告警阈值、备份保留与恢复目标、前端联调负责人。

未回答的选择保持“待定”，在其所在阶段的入口关口前再请用户决定。总计划获得确认也不等于自动批准这些具体选项。**每完成一个实施阶段即停止并等待用户确认**。
