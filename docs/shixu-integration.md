# 易忆前端与拾序后端整合

## 仓库与服务边界

- 前端仓库：`alibizho/xihack`。Node 24 服务提供构建后的页面和 `/api/training-feedback`；训练记录仍仅存在用户浏览器。
- 同学 2 后端仓库：`yassay1/shixu-backend`，作为前端仓库的 `backend/` Git 子模块固定引用具体提交。FastAPI 提供账号、任务提案、对话、Agent 与语音文字校准；PostgreSQL 保存账号和业务数据，另有 Agent worker。
- 上线时浏览器只访问 `https://jianwenjiuzhou.cloud`。Node 服务把除训练复盘外的 `/api/*` 请求转给同一个 Docker 网络中的 FastAPI，保留 Cookie、Origin、CSRF 头及 SSE 响应流。Python 在宿主机仅开放 `127.0.0.1:8811`，Node 仅开放 `127.0.0.1:8810`，Nginx 负责公网 HTTPS，避开已有项目使用的 8000 和 8787 端口。

开发时，在前端 `.env.local` 增加 `BACKEND_URL=http://127.0.0.1:8000`。Vite 的 `/api/*` 代理同样排除训练复盘。后端 `APP_ORIGIN` 必须与浏览器实际打开的 Vite 地址完全一致；生产环境则使用正式 HTTPS origin。

## 已有接口与缺口

后端 `contracts/openapi.json` 当前包含 `/api/auth/*`、`/api/tasks`、`/api/proposals/*`、`/api/conversations/*`、`/api/runs/*` 和 `/healthz`。账号模式的任务按“重要 / 紧急”二选一显示，浏览器演示模式继续使用 0–10 分；后端任务创建、更新、完成均经过提案与再次确认。已完成账号任务目前不能恢复待办，因为后端尚无对应接口。

前端语音输入使用浏览器语音识别；账号模式下，识别或输入的文字会调用后端 `/api/transcriptions` 校准文字和时间，但重要/紧急的初步判断仍由浏览器演示规则给出，用户必须自行核对二选一字段。后端可用 Agent Tool 创建待确认事务提案；对话页面从助手回复中识别提案编号，读取提案后交由用户确认。若助手没有在文字回复中包含编号，当前接口不能稳定列举该 run 的提案。线上联调还发现 MiMo 工具调用参数不完整导致事务查询 run 失败，见 [Agent 交接记录](backend-agent-handoff.md)。服务端音频回退需要额外本地 Whisper 模型，本部署没有启用；浏览器不上传音频。训练复盘由现有 Node 服务提供。账号数据与浏览器的演示任务不自动合并。

## 部署方式

1. 使用 `git clone --recurse-submodules` 获取完整项目。服务器的前端代码放在 `/opt/xihack/frontend`，子模块在 `/opt/xihack/frontend/backend`；从 `/opt/xihack` 运行 `docker compose --env-file .env -f frontend/deploy/compose.yaml`。当前环境使用固定提交，不自动追踪同学 2 的主分支。
2. 在 `/opt/xihack/.env` 放置随机生成的 `DB_PASSWORD`、`CSRF_SECRET`，以及两把分别用于训练复盘和同学 2 后端的 `MIMO_API_KEY`、`BACKEND_MIMO_API_KEY`，权限设为 600。密钥只在服务器配置，不进 Git；后端与 worker 使用后端专用密钥，Node 训练复盘使用原有密钥。PostgreSQL 使用独立 Docker 卷和独立数据库。
3. 先启动数据库，再用后端容器运行 `alembic upgrade head`；随后启动 backend、worker、frontend。最后将 `deploy/nginx.conf` 安装为此域名的独立 Nginx 站点并测试、重载。
4. 联调 HTTPS 页面、账号/CSRF、任务提案确认、对话与 Agent、专注复盘。现有域名证书可复用，但需留意自动续期。后端更新时先在前端仓库运行 `git submodule update --remote backend`，审核变化、提交新的子模块引用，再重建相关服务；不覆盖现有项目。

部署状态以实际运行记录为准。
