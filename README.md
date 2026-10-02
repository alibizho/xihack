# 拾序 · XiHack frontend

Mobile-first React, TypeScript, and Vite web app for voice-first task capture and attention training. The interface is in Simplified Chinese.

## Run locally

Requires Node.js 22 or newer.

```bash
npm ci
npm run dev
```

Open the local URL printed by Vite. To test from a phone on the same network, run `npm run dev -- --host 0.0.0.0`; microphone and camera features will require HTTPS when they are implemented.

For AI feedback after every completed 5×5 round, copy `.env.example` to `.env.local` and put your pay-as-you-go Xiaomi MiMo `sk-` key in `MIMO_API_KEY`. Keep `.env.local` on your computer; Git ignores it. The browser never receives the key. Without a key, the game and its ordinary result still work, and the AI area explains that the service is not configured. See [training AI setup and Alibaba Cloud deployment](docs/training-ai.md).

```bash
npm run build
npm test
```

## What this initial demo does

- **Today:** sample priorities, completion, and a prominent voice entry.
- **Tasks:** list and four-quadrant views, search, and a review step before adding a task. Tasks are saved in this browser with `localStorage`.
- **Voice / AI:** labelled mock transcription examples and mock field extraction. No audio is recorded or sent.
- **Training:** a three-level 5×5 Schulte game with local records and a per-round MiMo feedback request. AI feedback requires the server key and a reachable API.

The target behavior is described in [PRD v1.0](docs/PRD_v1.0.pdf), with the narrower hackathon scope in [frontend plan](docs/frontend-plan.md). This scaffold is a demo, not a completed PRD implementation.

## Project layout

| Path | Owner / purpose |
| --- | --- |
| `src/App.tsx`, `src/style.css` | Shared shell, navigation, and shared styles; coordinate changes here |
| `src/features/today/` | Today screen |
| `src/features/tasks/` | Task UI and mock task behavior |
| `src/features/training/` | Training contributor's page and styles |
| `src/shared/` | Reusable UI primitives only |
| `docs/` | Product scope and plans |

Each feature imports its own CSS. Keep feature state and styles in its folder; put code in `src/shared/` only when two features actually use it. The training contributor can replace `TrainingPage.tsx` and `TrainingPage.css` without touching the task flow.

## Contributing

1. Create a branch from `main`, named for your area (for example, `feat/schulte-5x5` or `feat/voice-input`).
2. Keep changes inside your feature folder where possible. Discuss edits to `App.tsx`, shared styles, or the task data shape before changing them.
3. Run `npm run build` and `npm test` before opening a pull request. Describe what works and what remains mocked.
4. Use Conventional Commits: `feat: add Schulte board`, `fix: preserve task draft`, `docs: clarify setup`. The description is one concise sentence at most.

Do not present mock answers as real AI output. Task changes must stay behind a user confirmation step. Camera work must be optional; raw camera frames must stay on device. The frontend plan records the intended backend endpoints and training quality gates.
