# 拾序 Web 系统架构设计

> 文档状态：已确认开放自助注册、同账号跨设备共享数据、首期不提供自助密码找回、后端持久化、PostgreSQL、Agent 对话历史；经典 5×5 舒尔特表留在前端，无眼动功能或后端训练 API。语音流程见 [ADR 0004](./adr-0004-local-voice.md)，阶段 6 参数见 [ADR 0005](./adr-0005-speech-stage-6.md)。

## 1. 系统上下文

    用户
      │ 浏览器 Web 应用
      │ 注册/登录；HttpOnly Cookie
      ▼ HTTPS
    FastAPI API ─────────────── PostgreSQL
      │                              ├─ users / sessions
      │                              ├─ tasks / preferences
      │                              ├─ conversations / messages
      │                              ├─ proposals / agent_runs / run_events
      │                              └─ migration-managed schema
      │
      ├─ Agent Run Worker ── 单一 Agent Runtime ── MiMo `mimo-v2.6-flash`
      ├─ Speech draft calibration（阶段 6；可选本地音频回退）
      └─ HTTPS 反向代理 / 限流 / TLS

## 2. 组件职责

### Web 前端

- 展示注册、登录、注销、任务、对话列表、聊天上下文和提案确认；前端独立提供经典 5×5 舒尔特表，无摄像头或眼动反馈。
- 请求带浏览器自动附加的会话 Cookie，不保存模型密钥、session token 或 user_id。
- 提供任务与对话的手动删除入口；以服务端 API 返回为准更新界面。
- 发送聊天消息后得到 run_id，再订阅 SSE；断线后读取 run 状态并重新连接。
- 前端负责麦克风录音、本地转写和可编辑草稿；默认只提交初步文字供后端校准，用户明确发送后才进入对话。

本地 xihack 目前是 React 19、TypeScript、Vite 的 UI 原型；任务存于 localStorage，当前转写/Agent 是演示实现，舒尔特页仍为占位。后端联调需要将任务数据权威从浏览器迁到 API。旧 localStorage 示例不自动导入，服务端新账号从空任务状态开始。

### API 与身份层

- 开放用户名 + 密码自助注册和登录，并设置/撤销服务端会话 Cookie；首期不提供自助密码找回。
- 将认证后的 user_id 放入服务器内部请求上下文；HTTP 请求体不接受身份字段。
- 统一处理授权、账号数据隔离、请求校验、CSRF/Origin、防滥用、OpenAPI Schema 与错误码。
- 提供任务、用户偏好、对话、消息、Agent run、提案确认/取消，以及阶段 6 的文字校准和可选音频回退 API。

### 应用与领域层

- Application Use Cases 负责每个业务读写与事务边界。
- Domain 包含任务状态、version、对话与提案状态规则。
- 任务 UI API 与 Agent 查询/提案确认复用相同业务用例。
- 任何写操作均需先校验账号归属；自然语言写入必须经提案确认。

### Agent Worker 与模型网关

- Worker 从 PostgreSQL 获取待处理 run，执行有限轮次的 Agent/Tool 循环并写入 run 状态和用户可见事件。
- 一个 Agent 和一个 MiMo LLM Provider；模型仅能调用明确定义的查询或提案 Tool，不直接访问数据库，也不能自行确认任务写入。
- Agent Tool 由应用层提供用户范围，严格限制参数和返回数据。
- 对话历史、当前用户输入和必要任务数据仅按需发送给模型；服务端提示与业务正文不会复制到通用日志。
- LLM 密钥只在服务器环境变量或部署 Secret 中。

### PostgreSQL

PostgreSQL 是账号、会话、任务、对话、消息、提案、run 状态和可重放 SSE 事件的 durable truth。每个用户数据对象绑定 user_id；所有访问都使用已认证账号范围。数据库约束、事务、索引和迁移由后端维护。

## 3. 关键数据流

### 用户注册、登录和认证请求

1. 注册或登录请求由 API 校验；密码经过安全哈希验证，不以明文持久化。
2. 登录成功后服务端创建可撤销会话并设置 Secure、HttpOnly、SameSite Cookie。
3. 后续请求由浏览器自动带 Cookie；API 查 session 得到 user_id。
4. Application Use Case 接收由服务端解析的 user_id 并限定所有读写范围。
5. 注销撤销当前会话，并清除浏览器 Cookie。

### 创建、查看和删除事务

1. 前端调用 tasks API；服务端通过会话识别当前账号。
2. 查询限定 user_id；创建/修改检查字段 allowlist、版本和幂等键。
3. 用户发起任务删除后先保存待确认意图；确认用例永久删除任务，不提供恢复。
4. 更新成功后前端展示服务端响应，不能将浏览器本机缓存作为权威状态。

### 对话与 Agent run

1. 前端创建对话或读取当前用户的对话列表。
2. 提交消息时，API 校验 conversation 属于当前账号，将用户消息持久化，并创建 agent_run 返回 run_id。
3. Worker 加载当前对话的消息、用户本轮输入与最少必要任务数据，调用单 Agent/LLM。
4. 查询任务的 Tool 只返回当前 user_id 数据。写操作只形成 proposal，不直接更改任务。
5. Worker 保存助手可见回复、提案和 run events。
6. 前端通过 SSE 查看状态/回复/提案；掉线后根据已保存事件和 run 状态续接。
7. 用户确认提案后，API 重新验证会话、提案归属/状态、任务版本、过期时间与幂等键，提交数据库事务。
8. 删除对话时清理消息及其摘要、未完成提案和运行记录，不级联删除任务。

### 语音（首期已确认流程）

1. 前端获取麦克风许可、录音并在本地转写；初步文字可编辑，默认不上传原始音频。
2. 前端提交初步文字与时区给后端校准。后端检查格式、日期/时间、完整性、任务意图和业务规则；不明确时返回澄清。此步不创建对话消息或 Agent Run。
3. 用户主动发送最终文字后才创建消息/run；涉及任务写入时生成待确认提案，用户明确确认后才执行。
4. 本地转写低置信度、用户主动重试或后端无法判断时，才提供可选音频上传/二次转写；格式、阈值、隐私告知与内存处理约束见 ADR 0005。

## 4. 账号隔离与数据生命周期

- 所有任务、偏好、对话、消息、提案及 run 都绑定账号；同账号在不同设备登录时共享这些数据。
- 客户端不能指定任意 user_id；模型工具参数也不能指定 user_id。
- API 对每个对象读取或变更都执行所有权验证，避免通过猜 ID 跨账号访问。
- 新建对话不加载既有对话历史；可以按需读取同一账号的真实事务。
- 不保存跨对话长期记忆或自动画像。对话历史保留至用户手动删除。
- 用户要求首期不提供一键删除全部账号数据；任务和会话仍可各自手动删除。
- 首期不提供自助密码找回或密码重置入口；用户忘记密码后无法自行恢复账号。账号注销流程仍未定义。

## 5. 部署拓扑

建议静态前端与 API 使用同一站点/同源反向代理，以简化 Cookie、CSRF 和 CORS。演示环境使用 HTTPS：

    Browser → HTTPS Reverse Proxy → FastAPI API
                                     ├─ PostgreSQL
                                     └─ Agent Worker（同一服务代码/镜像的进程角色）
                                               └─ MiMo `mimo-v2.6-flash`

起步可由一台小型主机部署 API 与 worker 角色，共用 PostgreSQL；按实际稳定性与容量拆开。无需第一版增加 Redis、独立消息总线、向量数据库、独立 Auth 微服务或多 Agent 编排框架。

部署还应具备密钥 Secret 注入、数据库备份、限流、请求体上限、超时、告警、日志脱敏、恢复策略和模型费用硬阈值。地区与服务平台需在部署阶段确认。

## 6. 参考采用原则

参考 laoshiren 的 PostgreSQL durable truth、模块化单体、Application Use Case 入口、Agent Tool 隔离、幂等/版本检查、run 状态与事件可恢复及 OpenAPI 契约治理。保留符合拾序产品的数据范围：没有跨对话记忆、训练、提醒、文件库或多 Agent，因此不复制对应子系统。

## 7. 尚待确认

- 用户名规则、会话期限和多设备会话管理。
- 对话 run/event 的保留与清理时点。
- 阶段 6 参数见 ADR 0005；真实浏览器性能与前端联调仍待验证。部署域名与预算限制留待阶段 7。
