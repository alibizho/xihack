# 易忆：任务与身心状态支持的后端方案（讨论稿）

**日期：**2026-10-02

**目标：**先把语音记事、个人任务、完成报告和自述状态连成闭环，让 AI 给出可解释的下一步建议。本文是接口与数据约定，不表示这些接口已经实现。

## 1. 这次 pivot 改变了什么

后端同学说目前只有「agent 入口操作用户的 task 表」。这足以演示自然语言改任务，但不足以支持跨设备的个人记录，也没有稳定的数据供 AI 了解用户如何完成任务、何时感到吃力。

新的最小闭环是：

1. 用户说话或打字，语音先转成**可编辑文本**。
2. Agent 从文本提出任务草稿；用户确认后，普通任务接口才写入 `tasks`。
3. 用户完成、部分完成或受阻时，提交一条任务报告。
4. 用户可自愿记录当下心情、精力、压力。AI 读取近期任务、报告和自述状态，推荐一个可执行的下一步，并说明依据。
5. 调整截止时间、重要度、紧急度或删除任务，都由用户确认后写入；AI 建议本身不等于数据库变更。

这里的「状态」是用户**主动填写的感受**，不是从声音或摄像头推断的诊断。旧版 [PRD v1.1](./易忆_PRD_v1.1.pdf) 明确排除了心理评估和治疗建议；如决定正式转向心理健康产品，需要另写产品、安全和隐私要求。当前 MVP 宜定位为**正念式任务支持**，不声称监测或诊断心理疾病。[WHO 对心理健康 AI 的近期讨论](https://www.who.int/news/item/20-03-2026-towards-responsible-ai-for-mental-health-and-well-being--experts-chart-a-way-forward)强调安全、问责和人的福祉。

## 2. 每个用户的数据怎么存

**先确定登录身份。**使用现有认证系统或托管认证服务，取得稳定的 `user_id`；`username` 只是显示名，不能用作数据归属或鉴权。若后端还没有认证，必须先完成注册/登录/退出与会话验证；采用托管认证时用其现成接口，不必另造一套密码 API。访客可以继续存在浏览器本地，登录并征得用户确认后再迁移。不要把演示任务自动写到真实用户账号。

| 表 | MVP 字段 | 用途 |
| --- | --- | --- |
| `profiles` | `user_id`（主键，关联认证用户）、`username`、`timezone`、`created_at`、`updated_at` | 每位用户一行。先保持页面简单，只编辑用户名；时区用于解释“明天 15:00”。 |
| `tasks`（**扩展现有表**） | `id`、`user_id`、`title`、`category`、`due_at`（可空）、`importance`、`urgency`、`importance_reason`、`urgency_reason`、`status`、`completed_at`、`created_at`、`updated_at` | 唯一任务事实源。`importance`/`urgency` 分别为 `0.0–10.0`，支持一位小数；`status` 至少有 `todo`/`done`。保留用户手动修改的数值。 |
| `check_ins` | `id`、`user_id`、`mood`、`energy`、`stress`、`note`（可空）、`recorded_at` | 用户主动提交的状态；三个数值可用 `0–10`，但不要求每次都填满。心情、精力越高表示越好，压力越高表示越大；这不是临床量表。一个用户一天可有多次记录。 |
| `task_reports` | `id`、`user_id`、`task_id`、`outcome`（`done`/`partial`/`blocked`）、`note`（可空）、`minutes_spent`（可空）、`recorded_at` | “做完了什么、哪里卡住了”的历史。提交 `done` 报告时，可在同一事务里把任务标为完成。 |

关系：一个认证用户对应一个 `profile`、多项 `tasks`、多条 `check_ins`；一项任务对应多条 `task_reports`。报告里的 `task_id` 必须属于同一个 `user_id`。删除用户账号时，这些个人数据需要一并删除；单纯删除显示名不应误删任务。

**暂时不建** `agent_memory`、永久音频库、心理状态画像表或聊天消息表。首版建议每次从近期 `tasks`、`task_reports` 和 `check_ins` 生成。若产品真的要展示建议历史，再加 `recommendation_runs`；若要可恢复聊天，再加有明确保留期的 `assistant_messages`。结构化事实比无限追加聊天记录更容易解释和删除。

### 数据库规则

- 各表的 `user_id` 都关联**认证用户**，而不是关联 `profiles`；这样删除显示资料不会误删任务。报告的 `task_id` 关联 `tasks`；`tasks(user_id, status, due_at)`、`check_ins(user_id, recorded_at)`、`task_reports(user_id, recorded_at)` 建索引。
- 分数用定点数（如 `numeric(3,1)`）和数据库 `CHECK (value BETWEEN 0 AND 10)`；`due_at` 用带时区时间，未安排用 `NULL`，展示时按 `profiles.timezone` 转换。
- 创建任务、报告和 check-in 时支持幂等键，避免网络重试导致重复记录。
- 服务端从已验证会话取得 `user_id`，忽略客户端传来的归属 ID；所有按 ID 读取、编辑、删除的操作都检查归属。若使用 PostgreSQL，可再启用行级安全策略，但不能把它当成无需测试的替代品。[PostgreSQL 行级安全文档](https://www.postgresql.org/docs/17/ddl-rowsecurity.html)、[OWASP 对对象级授权的说明](https://api-security.owasp.org/editions/2023/en/0xa1-broken-object-level-authorization/)。

## 3. 现在需要的 API

下面沿用现有前端的 `/api/profile`、`/api/transcribe` 叫法；若后端已有 agent 路由，保留该路由即可，无须同时实现两套 agent 服务。认证若由托管服务负责，就用其注册/登录/退出流程；若后端自己管理会话，至少需要 `POST /api/auth/register`、`POST /api/auth/login`、`POST /api/auth/logout` 和 `GET /api/auth/session`。两种方案选一种，任务与报告接口都必须验证会话。

| 优先级 | 接口 | 请求 / 返回 | 用于 |
| --- | --- | --- | --- |
| P0 | `GET /api/profile` | 返回 `{ id, username, timezone }`；未登录为 `401`，已登录但无资料为 `null` | 读取当前登录用户资料，也可作为会话检查。 |
| P0 | `PATCH /api/profile` | `{ username }` → 更新后的资料 | “我的”页面保存用户名。 |
| P0 | `DELETE /api/profile` | 删除显示资料，保留任务 | 对应目前“删除演示资料”；不要把它暗中变成删除账号。 |
| P0 | `GET /api/tasks?date=YYYY-MM-DD&status=todo` | 返回当前用户的任务数组；允许 `date` 为空或 `unscheduled=true` | 每日卡牌、未安排、四象限；四象限可用不带日期的查询。 |
| P0 | `POST /api/tasks` | 已确认的任务草稿 → 保存后的任务 | 语音或文字创建。 |
| P0 | `PATCH /api/tasks/:id` | 只允许更新标题、日期、分类、两轴分数、状态等明确字段 → 更新后的任务 | 编辑、滑杆、完成/恢复。 |
| P0 | `POST /api/transcribe` | `multipart/form-data` 音频 → `{ text }` | 录音转文字；文本仍由用户校正。 |
| P0 | `POST /api/agent/turn` | `{ mode, text?, timezone }` → 结构化草稿、澄清问题或建议 | 复用后端现有 agent 入口；详见下方模式。 |
| P0 | `POST /api/check-ins`、`GET /api/check-ins?limit=...` | 自述状态 / 最近记录 | 让用户主动反馈心情、精力、压力。 |
| P0 | `POST /api/tasks/:id/reports`、`GET /api/tasks/:id/reports` | 任务结果 / 该任务历史 | 完成报告，供建议参考。 |
| P1 | `DELETE /api/tasks/:id` | 删除已确认的任务 | UI 加入任务删除操作时再接入。 |
| P1 | `DELETE /api/account` | 删除账号及关联个人数据 | 只有在真实账号删除流程、确认和清理策略完成后提供。 |

`POST /api/agent/turn` 的 `mode` 先用四种即可：`task_capture`（生成任务草稿）、`task_report`（从一句话整理报告草稿）、`check_in`（从一句话整理自述状态草稿）、`advice`（推荐下一步）。**Agent 读取当前用户的数据库记录，不依赖前端把整个任务表或聊天历史发回来。**Agent 可以提出 `proposed_changes`，但最终由相应的 `POST/PATCH` 接口执行。若现有 agent 直接改 `tasks`，建议先加“只生成草稿/建议”的模式，再让用户确认后调用任务接口。

建议把响应限制为明确的 `type`：`task_draft`（含 `title`、`due_at`、`importance`、`urgency`、两轴原因）、`report_draft`（含 `task_id`、`outcome`、`note`）、`check_in_draft`（含用户明确表达的状态字段）、`advice`（见下例）或 `clarification`（一个需要追问的问题）。前三类草稿都返回 `requires_confirmation: true`，不能在生成时写库。

示例：

```text
POST /api/agent/turn
{"mode":"advice","text":"今天精力不太够，先做什么？","timezone":"Asia/Shanghai"}

200 OK
{"type":"advice","summary":"先推进一件短任务，再评估精力。","ranked_tasks":[{"task_id":"<uuid>","reason":"今天截止，且预计能分步完成","next_step":"先花 10 分钟列出提纲"}],"proposed_changes":[],"requires_confirmation":false}
```

对应的结构化写入请求可以保持很小：`POST /api/check-ins` 传 `{ "mood": 5, "energy": 3, "stress": 7, "note": "今天有点累" }`；`POST /api/tasks/:id/reports` 传 `{ "outcome": "partial", "note": "完成了提纲", "minutes_spent": 20 }`。两个接口都由服务端确定 `user_id` 和记录时间，返回带 ID 的已保存记录。

不必让 AI 覆盖用户设定的 `importance` 或 `urgency`。自述精力可影响**建议的任务顺序和下一步大小**，不应被解释为任务重要度自动下降。建议先考虑未完成任务的截止时间、重要度和紧急度，再参考最近的受阻报告与用户自述；每条建议都指向真实任务 ID，并给出简短依据。记录不足时只说明眼前任务，不编造长期行为模式；查无任务时可以建议休息或添加一项任务。

## 4. 语音到建议的边界

```text
用户点麦克风 → 浏览器录音 → POST /api/transcribe → 用户校正文字
→ POST /api/agent/turn (task_capture / task_report / check_in)
→ 用户确认草稿 → POST/PATCH 对应资源 → 以后可用 mode=advice 获取建议
```

浏览器使用 `getUserMedia` 和 `MediaRecorder`，需要安全上下文与用户许可；拒绝麦克风时保留文字入口。[MDN 录音指南](https://developer.mozilla.org/en-US/docs/Web/API/MediaStream_Recording_API/Using_the_MediaStream_Recording_API)、[MDN 麦克风权限说明](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)。原始音频默认仅用于本次转写，不写数据库；确需交给第三方语音服务时，应在产品中告知用途与保留方式。不要从声调自动推断心情或诊断。

## 5. 对接现有前端

| 现有前端位置 | 现状 | 接入时替换 |
| --- | --- | --- |
| `src/features/profile/mockProfileApi.ts` | `getProfile`、`updateProfile`、`deleteProfile` 使用浏览器本地演示数据 | 分别接 `GET/PATCH/DELETE /api/profile`；先实现真实认证。 |
| `src/features/tasks/mockTaskApi.ts` | `transcribeTask` 返回固定转写，`interpretTask` 本地规则评分 | 接 `POST /api/transcribe`；`interpretTask` 调用 agent 的 `task_capture` 模式并转换为当前 `TaskDraft`。 |
| `src/App.tsx` | 任务、输入历史存在 `localStorage` | 将读写收进一个 `taskApi` 模块，再接任务接口。确认身份与同步规则后，才迁移已有访客数据。 |
| 未来的 check-in / report UI | 尚不存在 | 新增薄 API 模块和简单输入卡，复用文字/语音输入与确认流程。 |

当前前端任务使用 `due: "2026-10-03 15:00"` 或 `"待安排"`。后端应返回统一的 `due_at`（ISO 8601）或 `null`；前端适配层负责把它映射给现有页面。`importance`、`urgency` 保持 `0–10` 的小数，不要在接口里改成 `0–100` 而不标明转换。

## 6. 给后端同学的最短实施顺序

1. 确认认证与 `user_id` 来源；给现有 `tasks` 表补 `user_id`、两轴小数、状态与时间字段，并保证每个查询都按当前用户隔离。
2. 接任务的 `GET/POST/PATCH` 和资料的 `GET/PATCH`；前端先从 `localStorage` 切到真实接口。
3. 接语音转写；agent 先返回**可确认草稿**，不要直接执行修改。
4. 加 `check_ins`、`task_reports` 两张表和对应接口；做第一版 `advice`，只读最近记录和待办任务。
5. 验证两个账号不能互读/互改；验证空状态、错误转写、时区、重复提交、用户确认取消和删除后的数据边界。

**暂缓：**永久聊天记忆、音频存储、自动情绪识别、临床判断、复杂推荐训练管线。若用户表达严重困扰，常规任务建议不应冒充心理支持；这类响应需要单独设计、评审和测试。WHO 对健康场景 LLM 的安全与隐私风险有明确提醒：[WHO AI 健康伦理原则](https://www.who.int/news/item/28-06-2021-who-issues-first-global-report-on-ai-in-health-and-six-guiding-principles-for-its-design-and-use)、[WHO 对 LLM 健康应用的提醒](https://www.who.int/news/item/16-05-2023-who-calls-for-safe-and-ethical-ai-for-health)。
