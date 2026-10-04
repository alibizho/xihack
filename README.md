<div align="center">
  <img src="frontend/public/logo.jpg" alt="易忆彩色圆环标志" width="160" />
  <h1>易忆 · Indigo</h1>
  <p><strong>帮助用户从混乱进入行动，再从行动回到平静。</strong></p>
  <p>
    <a href="https://jianwenjiuzhou.cloud/">在线体验</a> ·
    <a href="https://b23.tv/MC6SeNl">演示视频</a> ·
    <a href="产品说明文档.md">产品说明</a> ·
    <a href="易忆路演PPT.pptx">路演 PPT</a>
  </p>
</div>

易忆是一个移动端优先的任务与专注支持 Web 原型：用户整理事务，与 AI 助理讨论下一步，完成行动后记录复盘，也可以通过找数训练观察单局表现。

目前实现面向个人使用。

## 技术栈

- 前端：React 19、TypeScript、Vite；支持简体中文和英文。
- 应用服务：Node.js 22，提供静态文件、训练复盘接口和后端 API 代理。
- 后端：FastAPI、PostgreSQL、SQLAlchemy、Alembic；按账号保存任务、会话、对话和 Agent 运行记录。
- AI：小米 MiMo 对话 API；浏览器内通过 Transformers.js 加载 Whisper Tiny 做语音转写。

## 快速开始

需要 Node.js 22+、npm 和 Docker Compose。以下命令从仓库根目录执行。

1. 启动 PostgreSQL 和后端 API：

   ```bash
   cd backend
   LOCAL_APP_ORIGIN=http://localhost:5173 docker compose up --build -d --wait
   cd ..
   ```

2. 进入 `frontend/`，安装依赖并启动前端：

   ```bash
   cd frontend
   npm ci
   npm run dev
   ```

3. 打开 Vite 输出的本地地址（默认 `http://localhost:5173`）。注册账号或使用访客入口；任务变更会先显示提案，确认后才保存。后端接口文档位于 `http://localhost:8000/docs`。

开发服务器把 `/api` 代理到本机 8000 端口。若需改端口，在 `backend/` 目录设置 `LOCAL_API_PORT` 启动 Compose，并在 `frontend/` 目录为 Vite 设置同名变量。任务管理不需要模型密钥；AI 对话、训练复盘和远端语音回退需要额外配置。

### 启用 AI

在 `backend/.env` 中设置 `MIMO_API_KEY`，并在 `frontend/.env.local` 中设置同一个 `MIMO_API_KEY`，供本地训练复盘接口使用。两个文件均被 Git 忽略；不要把密钥写入前端源码或提交到仓库。然后从 `backend/` 目录启动 Agent worker：

```bash
LOCAL_APP_ORIGIN=http://localhost:5173 docker compose --profile agent up --build -d --wait
```

首次使用浏览器本地语音转写时，还需要安全上下文、WebGPU 和模型下载；不支持时可以输入文字。用户主动选择音频回退时，后端可使用本地 Whisper 模型，或通过 MiMo ASR 处理。后端运行细节见 [后端说明](backend/README.md)。

### 部署状态

`backend/compose.yml` 用于本机演示。`deploy/` 另有前端与后端的 Compose、Dockerfile 和 Nginx 配置；在线演示地址见上方。部署时仍需配置服务器环境变量、HTTPS 证书、持久化数据库和迁移流程。

## 核心功能

| 功能 | 主要代码 |
| --- | --- |
| 注册、登录、访客入口与会话 | `frontend/src/features/profile/`、`backend/src/assistant_backend/presentation/auth.py` |
| 任务列表、双轴优先级、创建与完成提案确认 | `frontend/src/features/tasks/`、`backend/src/assistant_backend/application/tasks.py` |
| 对话式任务查询和规划、Agent 工具调用与实时进度 | `frontend/src/features/tasks/VoiceAssistant.tsx`、`backend/src/assistant_backend/agent/` |
| 浏览器本地语音转写、文字校准、用户可选音频回退 | `frontend/src/features/tasks/speech/`、`backend/src/assistant_backend/application/speech.py` |
| 方格与环形 5×5 找数训练、单局记录和 AI 复盘 | `frontend/src/features/training/`、`frontend/server/trainingFeedback.ts` |
| 任务完成报告与训练摘要供 Agent 按需查询 | `frontend/src/features/tasks/TaskReportDialog.tsx`、`backend/src/assistant_backend/application/` |

任务和对话存在 PostgreSQL；训练单局记录主要保存在当前浏览器，派生摘要会尝试同步到后端。没有模型密钥时，不会伪造 AI 回复：相应请求会返回错误。当前仓库尚无经过验证的线上部署或企业收益数据。

## 大模型与 API 使用说明

| 模型或服务 | 调用位置与方式 | 用途 |
| --- | --- | --- |
| MiMo `mimo-v2.6-flash` | `backend/src/assistant_backend/agent/provider.py` 向 MiMo `/v1/chat/completions` 发送流式请求；`frontend/server/trainingFeedback.ts` 向同一路径发送 JSON 请求 | Agent 对话、任务工具调用、完成报告分析和训练复盘 |
| MiMo `mimo-v2.5-asr` | `backend/src/assistant_backend/application/speech.py` 向 MiMo `/v1/chat/completions` 发送用户主动提交的 WAV 音频 | 本地语音转写不可用时的可选回退 |
| Whisper Tiny | `frontend/src/features/tasks/speech/browserAsr.worker.ts` 通过 Transformers.js 在浏览器中加载并推理 | 默认语音转写；原始音频默认不上传 |

当前 Agent 实际选用 MiMo。配置中虽然保留 OpenAI Next / DeepSeek 参数，`backend/src/assistant_backend/config.py` 的 `chat_provider` 当前没有选用它。赛事如要求赞助商 API 使用清单，提交前应核对赞助商名称与实际调用记录，不把未调用的服务列为已使用。

## 项目结构

```text
├── frontend/            # React 界面、Node 服务及前端构建配置
├── backend/             # FastAPI、数据库迁移、Agent 和后端测试
├── deploy/              # Compose、Dockerfile 和 Nginx 配置
├── docs/                # 产品与前后端设计资料
└── README.md
```

## 测试说明

```bash
cd frontend
npm run build
npm test
```

前端测试覆盖任务模型、Agent API 数据处理、训练规则、认证与国际化等。后端测试需要名称以 `_test` 结尾的独立可丢弃 PostgreSQL 数据库。设置 `TEST_DATABASE_URL` 后，在 `backend/` 目录运行 `uv run pytest -p no:cacheprovider -q`。还可运行 `uv run ruff check .` 和 `uv run ruff format --check .`。自动测试不能替代真实模型凭证和路演环境的端到端验证。

## 团队成员

- 谷松旭
- Zhomart Alibi
- 谢梁栖玉
- 邓武轩
- 曹楠
