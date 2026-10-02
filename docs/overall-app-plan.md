# Overall app plan — hackathon release

## Product target

Ship one mobile-first web link for Android Chrome and desktop Chrome. The demo combines a voice-first AI task list with classic 5×5 Schulte training and quality-gated gaze feedback. This deliberately reduces the larger [PRD v1.0](PRD_v1.0.pdf) scope: accounts, sync, reminders, three additional training modes, and an Android APK come later. Personal tasks and training records stay in the browser for this release.

## Responsibilities and interface

- **Frontend:** Own task state, browser storage, Schulte rules and timing, gaze calibration, quality checks, result replay, and confirmation of every task change. It must show actual saved tasks for queries and never treat an AI proposal as a completed action.
- **Backend:** Run one small service with the OpenAI key, a spending limit, and no personal task or training database. It handles Mandarin transcription, structured task interpretation, and written gaze feedback. Raw camera frames never leave the browser; audio is sent only for transcription and is not retained by this app. The frontend sends the minimum task context needed for interpretation and derived gaze metrics for feedback.
- **API:** `POST /api/transcribe` accepts audio and returns `{ text }`. `POST /api/interpret` accepts `{ text, now, timezone, tasks }` and returns either a clarification, matching task IDs, or a create/update/complete proposal. `POST /api/gaze-feedback` accepts validated metrics and a small set of reviewed research references, and returns `{ observation, suggestion, confidence, source, limitation }`. The frontend validates responses and commits task changes locally only after user confirmation. OpenAI supports [audio transcription](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create) and [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

## Delivery order and acceptance

1. Prove WebGazer calibration and gaze quality on the actual Android phone and laptop. If either fails, the required gaze-feedback demo is blocked; do not fabricate advice from noisy data.
2. Complete manual tasks and the 5×5 game, then add voice transcription and AI task proposals.
3. Add gaze replay and quality-gated AI feedback using fixed metrics and reviewed sources. The AI explains measurements; it does not calculate the score or invent research.
4. Deploy over HTTPS and run the full demo on both devices. Check voice permission denial, ambiguous tasks, duplicate confirmation, reload persistence, wrong taps, interruption, camera denial, failed calibration, and AI outages.

The release passes when voice task creation and confirmation, local persistence, correct Schulte timing, and validated gaze feedback all work on both demo devices. When gaze quality fails, the game and normal result still work and the result clearly says why advice is unavailable.
