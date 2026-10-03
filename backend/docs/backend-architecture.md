# 后端架构设计

> 状态：已确认用户名 + 密码、开放自助注册、同账号跨设备共享、首期不提供自助密码找回、服务端保存用户数据、PostgreSQL、单 Agent、前端本地转写与后端校准/业务核验、HTTPS 小规模演示。身份见 [ADR 0002](./adr-0002-identity.md)，语音流程见 [ADR 0004](./adr-0004-local-voice.md)，阶段 6 参数见 [ADR 0005](./adr-0005-speech-stage-6.md)。

## 1. 目标与架构决策

采用 Python / FastAPI 模块化单体，为 React/Vite 前端提供账号认证、事务 API、对话 API、Agent 运行流和阶段 6 的转写文字校准/业务核验能力。录音和初步转写归前端；PostgreSQL 是账号、任务、对话、消息、提案及 Agent run 的持久化权威数据源。

首期不采用微服务、Redis、向量数据库或独立工作流引擎。根据已确认的 SSE 两阶段接口（提交消息创建 run，再订阅事件），建议由同一项目中的 Agent worker 从 PostgreSQL 领取待执行 run；API、worker 可使用同一代码包和部署镜像。PostgreSQL 持有待执行 run 与事件，避免把 Redis 或进程内状态当作恢复依据。演示规模下可先共用数据库和单节点，后续按负载拆分部署角色。

## 2. 技术建议

| 领域 | 建议 | 理由 |
|---|---|---|
| API | FastAPI + Pydantic API Schema | Python 生态成熟，适合 REST、文件上传和 OpenAPI |
| 数据库 | PostgreSQL | 事务、关系约束与账号数据隔离，作为 durable truth |
| ORM | SQLAlchemy 2.x | 显式 Session/事务边界；一个 Session 不跨并发请求/任务共享 |
| 迁移 | Alembic | 为 PostgreSQL 表结构变更提供版本化 migration |
| 密码 | Argon2id 密码哈希，经受维护的密码库实现 | 不存储或可逆加密明文密码 |
| 登录会话 | 服务端可撤销的 opaque session | 浏览器只持有 HttpOnly Cookie；服务端可退出、过期或撤销会话 |
| 模型 | 阶段 4 的 MiMo `mimo-v2.6-flash` API 适配器 | 模型接口与应用用例隔离，密钥只由服务端部署注入 |
| Agent 输出 | 结构化 schema + 应用侧再次校验 | 降低结构错误；模型输出仍视为不可信输入 |
| SSE | PostgreSQL 持久化 run 状态与可重放事件 | 支持掉线后查状态、重连继续读取 |
| 部署 | HTTPS 反向代理 + FastAPI API 进程 + Agent worker 进程 | 先保持单体与低运维负担；运行职责可按需分进程 |

FastAPI 官方安全教程以安全密码哈希为例，并展示 Argon2；OWASP 建议使用现代自适应哈希算法，密码不得明文或可逆加密保存。Cookie 会话应设置 Secure、HttpOnly、SameSite，并对状态变更请求使用来源校验和适当 CSRF 防护。参见文末官方资料。

## 3. 逻辑分层

依赖方向：

    Presentation / Agent Runtime / Worker → Application → Domain
    Infrastructure 实现 Application Ports

- Presentation：FastAPI router、认证依赖、API DTO、错误映射与 SSE 响应。
- Application：注册、登录、会话、任务 CRUD、对话、消息提交、run 执行、提案确认和删除等用例；在此确定事务边界和用户授权范围。
- Domain：任务规则、任务版本、提案状态转换、对话与 run 状态等不依赖框架的规则。
- Agent Runtime：读取当前对话上下文、向单一 LLM 提供受限 Tools、执行有限轮次并形成回复或提案；不直接访问 Repository/ORM。
- Infrastructure：SQLAlchemy repository、阶段 4 确定的 LLM adapter、密码哈希、随机会话凭证、时钟、日志和限流 adapter。
- Composition Root：集中装配依赖；FastAPI 路由保持薄，不在 router 内堆叠业务或模型调用。

API Schema、Application DTO、Domain Entity 和 ORM Model 分开。Agent Tools 只能调用 Application Use Case；模型不能生成 SQL、任意函数名或跨账号 user_id。

## 4. 建议模块边界

    backend/
      src/assistant_backend/
        main.py
        bootstrap.py
        config.py
        presentation/
          routes/auth.py
          routes/tasks.py
          routes/conversations.py
          routes/agent_runs.py
          routes/proposals.py
          speech.py  # 阶段 6 文字校准与可选音频回退
          schemas/
          errors.py
          dependencies.py
        application/
          identity/
          tasks/
          conversations/
          agent_runs/
          proposals/
          speech.py  # 阶段 6 草稿校准与本地模型适配
          ports.py
        domain/
          identity/
          tasks/
          conversations/
          agent/
        infrastructure/
          persistence/
            models/
            repositories/
            unit_of_work.py
          security/
            password_hasher.py
            session_tokens.py
          ai/
            openai_adapter.py
          observability/
        worker/
          agent_run_worker.py
      migrations/
      contracts/
        openapi.json

这是逻辑布局建议，不是本轮要生成的代码。模块可随真实代码规模收敛，但授权、持久化、Agent 与供应商适配边界应保持清楚。

## 5. PostgreSQL 数据边界

首期建议的主要实体：

- users：内部 user_id、规范化用户名、显示用户名、密码哈希、状态、创建时间。
- sessions：会话凭证哈希、user_id、创建/过期/撤销时间；不能储存浏览器持有的原始会话凭证。
- user_preferences：必要且由用户明确设定的偏好。
- tasks：user_id、任务字段、版本和时间戳；删除为永久删除。
- conversations：user_id、标题、创建/更新时间、删除状态。
- messages：conversation_id、角色、可见正文、创建顺序；正文为用户要求保存的对话历史。
- conversation_summaries：只为续接单个对话服务，不进入其他对话的上下文。
- proposals：user_id、conversation_id、operation、patch、expected_version、状态、过期时间。
- agent_runs：user_id、conversation_id、触发消息、执行状态和错误分类。
- run_events：run_id、序号、面向用户的事件类型/负载与时间，用于 SSE 恢复。

每条业务记录都有明确账号归属；Repository 查询必须带由已认证会话得到的 user_id。服务层必须在读取与写入时验证对象归属。数据库约束、外键和索引作为第二层保护。首期不建立 long-term memory、训练、gaze 或向量表。

## 6. 事务、并发与删除

- 每个 HTTP 请求或 worker job 使用自己的 SQLAlchemy Session / AsyncSession，不在并发任务间共享同一会话；一个 Use Case 定义清楚 commit/rollback 边界。
- 对任务写入使用 version / expected_version，拒绝静默覆盖；重要写请求接受幂等键，避免浏览器重试导致重复执行。
- 提案确认与对应任务写入在一致的数据库事务内校验归属、状态、有效期、版本和幂等性。
- 用户删除对话时，停止或废弃未完成 run，清理消息、摘要、提案与关联事件；不删除任务。
- 任务删除为永久删除；删除也必须先保存待确认意图，再由确认用例执行。
- 数据库迁移全部使用 Alembic 版本脚本；每次迁移先在备份/可回滚策略下发布。

## 7. 登录与 Web 安全基线

- 注册与登录只接收用户名、密码；登录成功后由服务端设置随机 opaque session Cookie。浏览器不传 user_id，不在 localStorage/sessionStorage 保存会话令牌。
- 密码只保存 Argon2id 哈希；验证错误使用不暴露“用户名不存在还是密码错误”的统一响应，并对登录/注册尝试限速。
- Cookie 建议使用 __Host- 前缀、Secure、HttpOnly、SameSite=Lax 或 Strict、Path=/ 且不设置 Domain。生产站点走 HTTPS。
- 对所有修改状态的请求校验 Origin/Referer，并使用 CSRF token 或经评估的等效防护；SameSite Cookie 只是纵深防护。优先将静态前端与 API 放在同一站点/同源。
- 账号归属由服务器认证上下文注入；所有 tasks/conversations/messages/proposals/runs 查询都限定 user_id。不能信任请求体、URL 参数或模型 Tool 参数给出的用户身份。
- 开放注册和登录均按 IP 与用户名维度限速，错误提示和响应时间尽量降低账号枚举信号。
- 登录后轮换当前设备会话；注销撤销当前会话。空闲 30 分钟、最长 8 小时；多会话管理界面待后续阶段确认。
- LLM 密钥由环境变量或平台 Secret 注入；日志与错误追踪不得包含密码、Cookie、会话 token、原始音频或对话正文。

## 8. Agent、LLM 与工具安全

单 Agent / 单 LLM；Agent Runtime 将受控任务查询工具和结构化提案 schema 提供给模型。查询和写提案工具均有明确定义的字段、长度限制、枚举和最大返回量。每次工具调用都由应用重新验证账号权限与参数。

模型只能要求查询真实任务、生成澄清或产生写入提案。只有 Proposal Confirmation Use Case 在用户点击确认并通过归属、版本、过期与幂等检查后能写任务。模型输出 schema 校验不是授权机制。OpenAI 官方文档建议明确 Tool 参数并启用 strict schema；应用仍须自行检查权限与业务规则。

Agent 上下文范围仅限当前对话历史、用户本轮消息、必要偏好和按需查询的当前任务。新对话不装入旧对话摘要。摘要只服务当前对话续接，不构成业务事实。对话消息保存供用户回看；用户删除后按产品策略清理关联状态。

## 9. 运维、限额与隐私

- 小规模 HTTPS 演示设置每账号、每 IP、并发、上传大小、Agent Tool 轮次、响应时长、token 和全局 Provider 预算限制。
- 通过反向代理做 TLS、请求大小限制、超时和 IP 级基础防护；CORS 仅限制浏览器来源，不是身份验证。
- 统一异常结构、request_id、LLM 错误映射与受控重试。日志仅记录必要运行元数据和用量，不记录业务正文。
- 默认只接收前端本地转写的初步文字，按不可信输入校准格式与日期/时间、检查完整性/意图及业务规则；文字校准不创建消息、run 或任务写入。
- 仅低置信度、用户主动重试或后端无法判断时提供可选音频二次转写；音频回退的格式、上传限制、清理和隐私策略见 ADR 0005。
- PostgreSQL 备份、恢复演练、数据地域、连接池、自动迁移发布策略和精确限额在部署 ADR 中确定。
- 首期不引入 Redis、LangGraph、独立队列、中间件微服务或向量数据库。若 Postgres 持久化 run 轮询不足，再基于容量证据评估 Redis 做唤醒/限流协调，但不能替代数据库中的 run 真相。

## 10. 与 laoshiren 的采用关系

参考 D:\proj\laoshiren 的后端 v2.2 架构与工程约束，采用模块化单体、Presentation/Application/Domain/Infrastructure 分层、Use Case 作为业务写入口、Agent Tool 只做适配器、PostgreSQL 持久真相、版本/幂等校验、迁移管理和冻结 API 合同。

不直接照搬其长期记忆、Personal State、多 Agent、LangGraph checkpoint、Redis、通知、文件处理和自动化调度系统。拾序不做跨对话长期记忆；首期用户规模与功能也不足以支撑这些组件。

## 11. 官方技术参考

- FastAPI OAuth2、密码哈希与 Argon2 示例：https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/
- OWASP Password Storage Cheat Sheet：https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- OWASP Authentication Cheat Sheet：https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- OWASP Session Management Cheat Sheet：https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- OWASP CSRF Prevention Cheat Sheet：https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
- SQLAlchemy 2.0 Session Basics：https://docs.sqlalchemy.org/en/20/orm/session_basics.html
- Alembic Tutorial：https://alembic.sqlalchemy.org/en/latest/tutorial.html
- OpenAI Function Calling：https://developers.openai.com/api/docs/guides/function-calling
- OpenAI Structured Outputs：https://developers.openai.com/api/docs/guides/structured-outputs

## 12. 尚待确认

- 用户名允许字符、规范化、大小写和长度规则。
- 会话 Cookie 空闲/绝对期限、多设备会话列表与单设备注销行为。
- 阶段 6 参数已见 ADR 0005；真实浏览器性能、前端联调和目标服务器推理容量仍待验证。
- 阿里云 HTTPS 域名、LLM 项目预算、账号/IP/全局速率值与告警阈值。
