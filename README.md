# 拾序 · XiHack

Mobile-first React, TypeScript, and Vite web app for voice-first task capture and attention training. The interface is in Simplified Chinese.

## Run locally

Requires Node.js 22 or newer.

```bash
git clone https://github.com/alibizho/xihack.git
cd xihack
npm ci
npm run dev
```

The backend source lives in `backend/`. See its README for local database setup, then set `BACKEND_URL` in `.env.local` when using account features. The browser-only task demo runs without the backend.

Open the local URL printed by Vite. To test from a phone on the same network, run `npm run dev -- --host 0.0.0.0`; microphone and camera access require a secure context outside localhost.

For AI feedback after every completed 5×5 round, copy `.env.example` to `.env.local` and put your pay-as-you-go Xiaomi MiMo `sk-` key in `MIMO_API_KEY`. Keep `.env.local` on your computer; Git ignores it. The browser never receives the key. Without a key, the game and its ordinary result still work, and the AI area explains that the service is not configured. See [training AI setup and Alibaba Cloud deployment](docs/training-ai.md).

```bash
npm run build
npm test
```

## Current features

- **Today and tasks:** browser demo data remains local; signed-in users can fetch account tasks and confirm backend task proposals. Importance and urgency use yes/no in account mode.
- **Voice:** browser speech recognition produces text; signed-in users can send that text for backend intent and time calibration. Raw audio is not uploaded by this flow.
- **Training:** a three-level 5×5 Schulte game with local records and saved per-round MiMo feedback. Reviews can be reopened from training history.
- **Account and assistant:** registration, sign-in, conversations, and Agent runs are connected to the backend. MiMo task query, pending proposal, and confirmation passed live account verification, see [the handoff note](docs/backend-agent-handoff.md).

The target behavior is described in [PRD v1.0](docs/PRD_v1.0.pdf), with the narrower hackathon scope in [frontend plan](docs/frontend-plan.md). Integration and deployment details are in [the integration guide](docs/shixu-integration.md).

## Project layout

| Path | Owner / purpose |
| --- | --- |
| `src/App.tsx`, `src/style.css` | Shared shell, navigation, and shared styles; coordinate changes here |
| `src/features/today/` | Today screen |
| `src/features/tasks/` | Task UI and mock task behavior |
| `src/features/training/` | Training contributor's page and styles |
| `src/shared/` | Reusable UI primitives only |
| `backend/` | Backend source imported from [yassay1/shixu-backend](https://github.com/yassay1/shixu-backend), with integration fixes |
| `server/`, `deploy/` | Node API gateway, training review endpoint, and Alibaba Cloud deployment |
| `docs/` | Product scope and plans |

Each feature imports its own CSS. Keep feature state and styles in its folder; put code in `src/shared/` only when two features actually use it. The training contributor can replace `TrainingPage.tsx` and `TrainingPage.css` without touching the task flow.

Backend source was imported from `yassay1/shixu-backend` commit `1c0e28d`. Review upstream changes and merge them into `backend/` before deployment; this repository contains the full deployable source.

## Contributing

1. Create a branch from `main`, named for your area (for example, `feat/schulte-5x5` or `feat/voice-input`).
2. Keep changes inside your feature folder where possible. Discuss edits to `App.tsx`, shared styles, or the task data shape before changing them.
3. Run `npm run build` and `npm test` before opening a pull request. Describe what works and what remains mocked.
4. Use Conventional Commits: `feat: add Schulte board`, `fix: preserve task draft`, `docs: clarify setup`. The description is one concise sentence at most.

Do not present mock answers as real AI output. Task changes must stay behind a user confirmation step. Camera work must be optional; raw camera frames must stay on device. The frontend plan records the intended backend endpoints and training quality gates.
