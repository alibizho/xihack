# 拾序前后端交接文档

> 生成日期：2026-10-02
> 事实依据：`backend/src/assistant_backend` 实际路由与 schema、`backend/contracts/openapi.json`、`backend/tests`，以及 `xihack/src` 当前前端代码。
> 当前结论：后端接口已覆盖认证、任务/提案、对话历史和 Agent run；前端已接入账号任务与对话，仍保留独立的演示任务模式。以下原有“前端当前状态”记录的是 2026-10-02 接入前的情况。

## 1. 交接范围与现状

### 后端已实现

- FastAPI 应用入口：`/healthz`。
- 服务端 Cookie 会话认证：注册、登录、当前用户、CSRF token、退出。
- 任务只读查询：列表筛选、分页、详情。
- 任务写入提案：创建、更新、完成、删除提案；确认与取消。确认接口是实际写入任务的唯一入口。
- 多对话：创建、列表、消息历史、改标题、永久删除。
- Agent：提交用户消息并创建 run、读取 run、SSE 事件流、PostgreSQL 持久事件、数据库 lease worker、只读任务工具。
- Agent 可调用受限的任务变更提案 Tool；提案仍须用户调用确认 API 才能写任务。
- 阶段 6 后端文字校准 `POST /api/transcriptions` 与明确同意后的音频回退 `POST /api/transcriptions/audio`；草稿不保存为消息或 run，参数见 [ADR 0005](./adr-0005-speech-stage-6.md)。
- MiMo 配置默认值：`https://api.xiaomimimo.com/v1`、`mimo-v2.6-flash`；密钥来自后端 `MIMO_API_KEY`。

### 前端当前状态

`xihack` 当前使用 `xihack-demo-tasks` 这一 `localStorage` key 保存演示任务，任务字段为 `id/title/due/importance/urgency/importanceReason/urgencyReason/done/category`。当前没有 `fetch`、Axios、Cookie 会话、对话页面或 SSE 客户端，也没有调用旧设计中的 `/api/interpret`、`/api/transcribe`。`TaskComposer` 已在前端录音，但 `transcribeTask` 返回固定模拟文字，尚无本地语音模型。

因此前端接入必须替换本地任务状态和本地 toggle/save 流程；不能把本地 `done` 布尔值直接映射为后端任务写入。后端要求完成、编辑、删除也先创建提案，再由用户确认。

### 暂不属于可接入能力

- 前端本地转写尚未接入；`/api/voice/drafts/validate` 是阶段 6 冻结前的路径草案，不是当前 OpenAPI 路由。默认不上传音频，见 [ADR 0004](./adr-0004-local-voice.md)。
- 训练 API：当前不进入后端 OpenAPI；经典 5×5 舒尔特表留在前端，眼动功能已取消。
- 密码找回、会话列表/踢出其他设备、全量账号删除：未实现。

## 2. 通用前端调用约定

### 请求基础设置

```ts
async function apiFetch(path: string, init: RequestInit = {}) {
  return fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
}
```

- 浏览器必须发送 `credentials: "include"`，会话凭证在 HttpOnly Cookie 中，不在 JSON 中返回。
- 注册/登录需要精确 `Origin`；退出及业务写请求还需要 `X-CSRF-Token`。浏览器自动发送 Origin，后端的 `APP_ORIGIN` 必须与页面 origin 完全相同。
- 当前 FastAPI 未启用 CORS，Vite 也未配置 `/api` 代理。从 `localhost:5173` 直接请求 `localhost:8000` 会被浏览器跨源限制；最小联调应让前端始终调用相对路径 `/api/...`，开发时在 Vite 配置 `/api` 代理到后端，生产时由同源反向代理转发 `/api`。这是接入工作，尚未实现。
- 先登录或注册，再调用 `GET /api/auth/csrf` 获取 CSRF token；不要把 token 写入 URL。
- 所有数据接口都由服务端从会话确定账号；前端不要发送 `user_id`，即使发送也不会改变账号范围。
- 统一错误 JSON：

```json
{
  "code": "VERSION_CONFLICT",
  "message": "Request failed",
  "request_id": "server-generated-uuid",
  "retryable": false
}
```

`X-Request-ID` 响应头也会返回同一个请求 ID。前端应按 `code` 展示可恢复提示，不依赖 `message` 作为稳定枚举。

## 3. 认证接口

### `POST /api/auth/register` — 注册并登录

请求：

```json
{
  "username": "sample_user",
  "password": "user-entered-passphrase",
  "adult_declared": true
}
```

约束：用户名 3–32 位 ASCII 字母/数字/下划线；密码 15–128 字符；`adult_declared` 必须为严格布尔值 `true`。

成功：`201`

```json
{ "user": { "username": "sample_user" } }
```

同时设置会话 Cookie。用户名已存在、密码不符合规则等错误不要在前端拆解为账号枚举信息。

### `POST /api/auth/login` — 登录

请求与注册相同但不含 `adult_declared`。成功 `200`，响应同上并轮换会话 Cookie。认证失败返回 `401` 的 `AUTH_INVALID`。

### `GET /api/auth/me` — 恢复登录态

成功 `200`：

```json
{ "user": { "username": "sample_user" } }
```

未登录返回 `401 AUTH_REQUIRED`。页面启动时调用此接口，不要通过读取 Cookie 判断登录状态。

### `GET /api/auth/csrf` — 获取 CSRF token

成功 `200`：

```json
{ "csrf_token": "opaque-token" }
```

响应带 `Cache-Control: no-store`。没有有效会话不能获取。

### `POST /api/auth/logout` — 退出

需要 `Origin` 和 `X-CSRF-Token`，成功 `204`，并撤销当前会话、清除 Cookie。

## 4. 任务接口

### 4.1 任务数据模型

```ts
type Due =
  | { precision: "date"; date: string; timezone: string }
  | { precision: "minute"; at: string; timezone: string }
  | null;

type Task = {
  task_id: string;
  title: string;
  description: string | null;
  category: string | null;
  due: Due;
  important: boolean;
  urgent: boolean;
  status: "open" | "completed";
  version: number;
  created_at: string;
  updated_at: string;
};
```

`date` 不代表当天零点；`minute.at` 必须携带时区偏移，并且与 IANA `timezone` 一致。前端展示可以转换为中文，但提交必须使用上述结构。后端任务 ID 是服务端生成的 `task_id`，不是当前前端的 `id`。

### `GET /api/tasks` — 列表、筛选、分页

支持查询参数：`keyword`、`due_from`、`due_to`、`important`、`urgent`、`status`（`open|completed`）、`category`、`limit`（1–100，默认 20）、`cursor`。

响应 `200`：

```json
{
  "items": [
    {
      "task_id": "task-id",
      "title": "完成项目周报",
      "description": null,
      "category": "学习",
      "due": {
        "precision": "minute",
        "at": "2026-10-09T15:00:00+08:00",
        "timezone": "Asia/Shanghai"
      },
      "important": true,
      "urgent": false,
      "status": "open",
      "version": 1,
      "created_at": "2026-10-02T08:00:00Z",
      "updated_at": "2026-10-02T08:00:00Z"
    }
  ],
  "next_cursor": null
}
```

### `GET /api/tasks/{task_id}` — 详情

成功返回单个 `Task`。不存在或不属于当前账号统一为 `404 NOT_FOUND`。

### `POST /api/proposals` — 创建待确认提案

需要 `Origin`、`X-CSRF-Token`。此请求不会直接改变任务表，成功 `201`。

创建任务：

```json
{
  "client_request_id": "task-create-001",
  "operation": "create",
  "task": {
    "title": "完成项目周报",
    "description": null,
    "category": "学习",
    "due": {
      "precision": "date",
      "date": "2026-10-09",
      "timezone": "Asia/Shanghai"
    },
    "important": true,
    "urgent": false
  }
}
```

更新任务：

```json
{
  "client_request_id": "task-update-001",
  "operation": "update",
  "task_id": "task-id",
  "expected_version": 1,
  "changes": { "urgent": true }
}
```

完成或删除：

```json
{
  "client_request_id": "task-complete-001",
  "operation": "complete",
  "task_id": "task-id",
  "expected_version": 1
}
```

`operation` 只能是 `create/update/complete/delete`。同一账号复用相同 `client_request_id` 且正文相同会重放同一提案；正文不同返回 `409 IDEMPOTENCY_CONFLICT`。提案响应包含 `proposal_id`、操作内容、`status` 和 `expires_at`。

### `GET /api/proposals/{proposal_id}` — 读取提案

用于刷新、跨设备展示待确认预览。跨账号返回 `404`。

### `POST /api/proposals/{proposal_id}/confirm` — 确认并执行

需要 CSRF。请求：

```json
{ "idempotency_key": "confirm-001" }
```

成功 `200`：

```json
{
  "proposal_id": "proposal-id",
  "operation": "create",
  "task_id": "new-task-id",
  "task": { "...": "最终任务对象" },
  "status": "confirmed"
}
```

后端确认时再次检查账号归属、提案有效期、任务状态和 `expected_version`。重复使用相同 `idempotency_key` 返回原回执；异键重复确认返回冲突。常见错误：`PROPOSAL_EXPIRED`、`VERSION_CONFLICT`、`NOT_FOUND`。

### `POST /api/proposals/{proposal_id}/cancel` — 取消

需要 CSRF，成功 `204`。取消不会修改任务。

## 5. 对话与消息接口

### `POST /api/conversations` — 创建空对话

需要 CSRF。请求：

```json
{ "client_request_id": "conversation-001", "title": "新对话" }
```

成功 `201` 返回：

```json
{
  "conversation_id": "conversation-id",
  "title": "新对话",
  "created_at": "2026-10-02T08:00:00Z",
  "updated_at": "2026-10-02T08:00:00Z"
}
```

同账号相同 `client_request_id` 和标题会返回原对话；内容不同返回 `409 IDEMPOTENCY_CONFLICT`。标题首尾空白会清理，最终长度必须为 1–200。

### `GET /api/conversations` — 对话列表

查询：`limit`（1–100，默认 20）、`cursor`。响应：

```json
{
  "items": [
    {
      "conversation_id": "conversation-id",
      "title": "新对话",
      "created_at": "2026-10-02T08:00:00Z",
      "updated_at": "2026-10-02T08:00:00Z",
      "last_message_excerpt": null
    }
  ],
  "next_cursor": null
}
```

分页游标不透明，不要前端解析或自行生成。排序基于创建时间和 ID，改标题不会改变翻页位置。

### `GET /api/conversations/{conversation_id}` — 历史消息

查询：`limit`（1–100，默认 50）、`cursor`。响应在对话字段上增加 `messages` 和 `next_cursor`：

```json
{
  "conversation_id": "conversation-id",
  "title": "新对话",
  "created_at": "2026-10-02T08:00:00Z",
  "updated_at": "2026-10-02T08:00:00Z",
  "messages": [
    {
      "message_id": "message-id",
      "role": "user",
      "content": "帮我找今天的任务",
      "created_at": "2026-10-02T08:01:00Z"
    }
  ],
  "next_cursor": null
}
```

### `GET /api/conversations/{conversation_id}/proposal-ids` — 待确认 Agent 提案

成功 `200`：`{ "proposal_ids": ["proposal-id"] }`。只返回当前账号、当前对话中仍处于 `pending` 的 Agent 提案；对话不属于当前账号时返回 `404`。前端再调用 `GET /api/proposals/{proposal_id}` 展示确认卡片，不应从模型文字中提取提案编号。模型在保存提案后回答失败时，这个接口仍可找回提案。

### `PATCH /api/conversations/{conversation_id}` — 改标题

请求：`{ "title": "本周计划" }`；成功 `200` 返回更新后的对话。

### `DELETE /api/conversations/{conversation_id}` — 永久删除

需要 CSRF，成功 `204`。同时删除消息、run 和事件，不删除任务。删除后的 ID 不可恢复；正在运行的 worker 在写入前会复核对话仍存在。

## 6. Agent run 与 SSE

### `POST /api/conversations/{conversation_id}/messages`

需要 CSRF。请求：

```json
{
  "client_message_id": "message-client-001",
  "content": "帮我找今天重要的任务"
}
```

`content` 非空且最长 8000 字符。成功 `202`：

```json
{
  "run_id": "run-id",
  "status": "queued",
  "created_at": "2026-10-02T08:02:00Z",
  "replayed": false
}
```

消息和 run 在同一事务中写入；相同账号重用 `client_message_id` 且正文相同会返回同一 run 并将 `replayed` 设为 `true`。正文不同返回 `409 IDEMPOTENCY_CONFLICT`。

Agent 可使用 `search_tasks`、`get_task` 查询当前账号任务，也可调用受限 Tool 生成 create/update/complete/delete 待确认提案；模型不能直接创建、修改、完成或删除任务。模型回答只使用当前对话和当前账号任务。

限额由后端配置实际执行：每 run 最多 16 次模型请求、16 次 Tool 调用、180 秒、64K 输入 token、8K 输出 token；每账号 10 次/小时且最多 2 个并发 run，每 IP 30 次/小时，全局 10 次/分钟。超限返回 `429` 或 run 失败码。

### `GET /api/runs/{run_id}`

响应：

```json
{
  "run_id": "run-id",
  "status": "queued",
  "phase": "queued",
  "user_message_id": "message-id",
  "assistant_message_id": null,
  "assistant_content": null,
  "error_code": null,
  "created_at": "2026-10-02T08:02:00Z",
  "updated_at": "2026-10-02T08:02:00Z",
  "last_event_sequence": 1
}
```

`status`：`queued/running/completed/failed/cancelled`。当前代码没有公开取消 run 的接口；关闭 SSE 只停止订阅，不取消后端 run。

### `GET /api/runs/{run_id}/events` — SSE

请求头可带 `Last-Event-ID: 3`，也可用查询参数 `after=3`；两者同时存在时必须一致。返回 `Content-Type: text/event-stream`：

```text
id: 1
event: run.status
data: {"run_id":"run-id","phase":"queued","sequence":1}

id: 2
event: run.started
data: {"run_id":"run-id","attempt":1,"sequence":2}

id: 3
event: message.delta
data: {"run_id":"run-id","text":"找到了一条任务。","sequence":3}

id: 4
event: run.completed
data: {"run_id":"run-id","assistant_message_id":"assistant-id","sequence":4}
```

实际事件类型包括 `run.status`、`run.started`、`message.delta`、`run.completed`、`run.failed`、`run.snapshot`。事件序号持久化在 PostgreSQL，保留 7 天；过期游标会先收到 `run.snapshot`，随后继续发送可用事件。前端收到 `run.completed` 或 `run.failed` 后关闭 `EventSource`，再调用 run 状态接口和对话历史接口刷新最终结果。

建议的前端接入流程：

1. `POST /api/conversations` 创建或恢复当前对话。
2. `POST /messages` 得到 `run_id`。
3. `new EventSource(.../events?after=0)` 订阅；浏览器原生 `EventSource` 会自动重连，但需要前端保存最新 `event.lastEventId`，必要时改用 `fetch` 流读取以便持续发送认证/自定义头。
4. SSE 断开时先 `GET /api/runs/{run_id}`；若仍未结束，按最后序号重连。
5. 结束后 `GET /api/conversations/{conversation_id}` 获取权威消息历史，不把 delta 单独当作最终持久化结果。

## 7. 前端替换清单

| 当前 `xihack` 行为 | 后端接入后的行为 |
|---|---|
| `localStorage` 保存 `Task[]` | 启动后 `GET /api/tasks`，分页和筛选由 API 提供 |
| `id`、`done`、字符串 `due` | 使用 `task_id`、`status`、结构化 `due` |
| `toggle(id)` 直接改状态 | 创建 `complete` 提案，展示预览，调用 confirm 后刷新任务 |
| `save(task)` 直接插入本地数组 | 创建 `create` 提案，用户确认后 confirm，再用回执更新列表 |
| `mockProposal()` 推断任务 | 手动或 Agent 提案均由后端保存；用户明确确认后才写任务。语音初步文字可调用 `/api/transcriptions` 校准 |
| 没有账号 | 首屏执行 `/auth/me`，提供注册/登录/退出 |
| 没有对话页面 | 创建/选择 conversation，消息提交后使用 run 状态和 SSE |
| 训练页纯前端 | 继续保持本地功能；不要向当前后端发训练请求 |

`xihack` 的四象限显示可以继续使用 `important` 与 `urgent` 计算，但“完成”动作必须经过提案确认。后端不会接受前端的 `done` 字段。
前端的 0–10 重要度/紧急度及原因字段无法无损写入当前后端布尔字段；迁移字段或调整界面语义须在接入前明确，不得暗中四舍五入并声称已同步原分数。

## 8. 本地联调

后端：

```powershell
Set-Location D:\proj\heiks\backend
uv sync --extra dev
docker compose -f compose.test.yml up -d --wait
$env:DATABASE_URL = "postgresql+psycopg://shixu:shixu_test_password@127.0.0.1:55432/shixu_test"
uv run alembic upgrade head
uv run uvicorn assistant_backend.main:app --reload
```

运行 worker（另一个终端）：

```powershell
Set-Location D:\proj\heiks\backend
$env:DATABASE_URL = "postgresql+psycopg://shixu:shixu_test_password@127.0.0.1:55432/shixu_test"
uv run python -m assistant_backend.worker
```

前端开发服务器若使用 `http://localhost:5173`，后端 `APP_ORIGIN` 必须配成该地址；Vite `/api` 代理使浏览器仍从页面同源访问 API，前端请求带 `credentials: "include"`。生产由同源 HTTPS 反向代理转发 `/api`；不要仅改 `APP_ORIGIN` 而遗漏代理配置。

## 9. 已验证与未验证

依据当前仓库已有阶段记录和测试文件：

- 已覆盖认证、账号隔离、任务提案确认/取消、版本冲突、对话分页/幂等/级联删除、消息提交幂等、Agent 工具、SSE 重放、worker lease 恢复、限流和删除竞态。
- 后端阶段 4 真实 provider smoke test、生产 HTTPS、反向代理可信 IP、供应商预算和正式前端联调仍需在交接环境执行。
- 当前工作区没有可运行的前端 API 客户端；本文档是接入契约，不代表 `xihack` 已完成改造。

前端第一次接入后的最小验收顺序：注册/登录 → `/me` 恢复 → 获取 CSRF → 任务列表 → 创建任务提案/确认 → 完成提案/确认 → 创建对话 → 发消息 → SSE 断线重连 → 刷新对话历史 → 删除对话并确认任务仍在。
