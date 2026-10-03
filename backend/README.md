# 拾序后端

FastAPI + PostgreSQL 单体。当前已实现账号会话、任务只读与提案确认写入、多对话、消息/run/SSE、Agent 任务提案和阶段 6 语音后端接口。实际已发布路径见 [`contracts/openapi.json`](contracts/openapi.json)；[前后端交接](docs/frontend-backend-handoff.md)有请求示例。阶段 4 的真实 MiMo 凭证 smoke test 尚未通过，不能把 Agent 标为生产可用。

## 当前边界

| 能力 | 状态 |
|---|---|
| 账号、CSRF、任务列表/详情、手动提案/确认/取消、对话历史 | 代码与契约已存在 |
| 消息、Agent run、SSE、只读任务 Tool | 代码与测试已存在；真实 provider 凭证验证待完成 |
| Agent 生成任务写入提案 | 阶段 5 代码与测试已完成；仍须由用户确认提案才写任务 |
| 前端本地语音转写、后端文字校准/业务核验 | 阶段 6 后端接口已实现；前端接入待联调，默认不上传音频，见 [ADR 0004](docs/adr-0004-local-voice.md) 和 [ADR 0005](docs/adr-0005-speech-stage-6.md) |
| Agent 规划训练上下文 | `POST /api/training/summaries` 仅接收每局派生指标；Agent 只读摘要 Tool 按需读取，不接收点击原始序列 |

## Docker 本地启动

在本目录运行：

```bash
docker compose up --build -d --wait
```

打开 **[http://localhost:8000/docs](http://localhost:8000/docs)** 查看并试用 API；[OpenAPI JSON](http://localhost:8000/openapi.json) 和 [健康检查](http://localhost:8000/healthz) 也可直接打开。Compose 会启动持久化 PostgreSQL、执行 Alembic 迁移，再启动 API。这个 `compose.yml` 仅供本机开发，API 只绑定 `127.0.0.1:8000`；`compose.test.yml` 是另一个可丢弃的测试库。

在 Swagger 的 **Try it out** 中先调用 `POST /api/auth/register`（用户名、至少 15 位密码、`adult_declared: true`），再调用 `GET /api/auth/csrf`；随后 `GET /api/tasks` 会显示新账号的空列表。后续写请求把取得的 token 填入 `X-CSRF-Token`。

若 8000 端口已被占用，可运行 `LOCAL_API_PORT=8001 LOCAL_APP_ORIGIN=http://localhost:8001 docker compose up --build -d --wait`，然后打开 `http://localhost:8001/docs`。

```bash
docker compose logs -f api       # 查看启动/请求日志；Ctrl-C 退出日志
docker compose down              # 停止，保留数据库数据
docker compose down -v           # 重置本地数据库，删除所有本地数据
```

默认不启动 Agent worker，浏览 `/docs`、认证和任务 API 不需要模型密钥。若要试用 Agent，在本地 `.env` 填入 `MIMO_API_KEY`，然后运行 `LOCAL_APP_ORIGIN=http://localhost:5173 docker compose --profile agent up --build -d --wait`。当前 Agent 和完成报告分析实际选用 MiMo；配置中保留的 `OPENAI_NEXT_*` 参数不会让 Agent 切换到 DeepSeek。密钥只放在被 Git 忽略的本地 `.env`，不要提交。

前端联调让浏览器请求同源 `/api/...`：Vite 已配置 `/api` 代理，后端的 `LOCAL_APP_ORIGIN` 应与实际前端地址一致（默认 `http://localhost:5173`）。生产环境需要同源 HTTPS 反向代理。详见[接入计划](../docs/backend-api-data-model.md)。

## 不使用 Docker 开发

使用 Python 3.12/3.13、`uv sync --extra dev` 和独立 PostgreSQL。设置 `DATABASE_URL`、`APP_ORIGIN`、`CSRF_SECRET` 后依次运行 `uv run alembic upgrade head` 与 `uv run uvicorn assistant_backend.main:app --reload`。如需 Agent，再运行 `uv run python -m assistant_backend.worker`。`.env.example` 列出配置项；不要把真实密钥提交到仓库。

## 验证与部署前缺口

测试必须使用名称以 `_test` 结尾的独立可丢弃数据库：设置 `TEST_DATABASE_URL` 后运行 `uv run pytest -p no:cacheprovider -q`、`uv run ruff check .`、`uv run ruff format --check .`、`uv run alembic check`。更新实际路由后运行 `uv run python -m assistant_backend.export_contract`。`/healthz` 当前只证明 API 进程可响应，不检查数据库、worker 或模型。

生产部署仍需同源 HTTPS 代理、持久 PostgreSQL 与备份/恢复、迁移发布流程、独立 API 和 worker 进程、密钥注入、可信客户端 IP/限流配置、MiMo 凭证和预算验证。`APP_ENV=production` 时配置 HTTPS `APP_ORIGIN`、`__Host-` 会话 Cookie 名和独立的 32 字符以上 `CSRF_SECRET`；不要使用 `.env.example` 的示例值。现有 Docker Compose 仅用于本地开发和测试，没有生产代理配置。具体入口关口见[开发计划](docs/development-plan.md)。

## 阶段 6 语音后端

`POST /api/transcriptions` 接收初步文字并返回可编辑草稿，不创建消息或 Agent Run。`POST /api/transcriptions/audio` 仅在用户明确同意时处理可选音频回退，接受 16 kHz 单声道 16-bit PCM WAV（最长 20 秒、最大 1 MiB）。前端录音和本地转写不在此仓库实施；远端文档曾建议的 `/api/voice/drafts/validate` 是阶段 6 冻结前草案，不是当前 OpenAPI 路由。

在宿主机运行音频回退前，安装 `uv sync --extra dev --extra speech`，以 `uv run --extra speech uvicorn assistant_backend.main:app` 启动，并将仓库外预置的多语种 Whisper base CTranslate2 模型目录设为 `SPEECH_MODEL_PATH`；目录中需有 `model.bin`、`config.json`、`tokenizer.json` 和 `vocabulary.txt`。请求期间不会下载模型；单次加载与推理超过 60 秒会终止子进程。默认 Docker 镜像尚未安装 speech 可选依赖或挂载模型目录，因此 Docker 本地启动只验证文字校准；音频回退需上述宿主机配置。模型文件不得提交到仓库。
