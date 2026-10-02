# Frontend plan — voice tasks and Schulte training

## Goal and stack

Build a mobile-first web app that works in Android Chrome and desktop Chrome. Use React, TypeScript, Vite, plain CSS, and browser IndexedDB. The interface is in Simplified Chinese; this plan is in English. The hackathon scope is narrower than [PRD v1.0](PRD_v1.0.pdf): one Schulte mode, local data, and a web link.

## Build order

1. **Test gaze feasibility first.** Run [WebGazer](https://github.com/brownhci/webgazer) on the actual demo phone and laptop over HTTPS. Check camera permission, frame rate, calibration error, and whether tracking slows taps. Pin the tested version. Use WebGazer directly: React owns the game and interface. The [jsPsych eye-tracking guide](https://www.jspsych.org/latest/overview/eye-tracking/) says its extension does not support the official WebGazer release. WebGazer is GPLv3 and its official maintenance has ended; release the frontend under GPLv3.
2. **Build tasks.** Provide Today and Tasks screens, a list and four-quadrant view, and separate importance and urgency controls. Save tasks locally. Voice is the main entry: record audio, show editable transcription, request an AI proposal, then show an editable preview before committing it. Manual entry, search, edit, and completion remain available when the microphone or AI fails.
3. **Build classic 5×5 Schulte.** Randomly place 1–25 once per round. Only the next correct tap advances; numbers stay visible and mistakes add no time penalty. Use `performance.now()` for the clock. Save every tap, total time, mistakes, and per-number intervals. Mark a round interrupted when the page loses visibility; never count it as a completed result.
4. **Add optional gaze capture and feedback.** Ask for camera access only when the user enables gaze tracking. Use nine calibration points and five separate validation points. Let `S` be the minimum distance between adjacent cell centers. Give cell-level gaze feedback only when valid samples are at least 85%, median validation error is at most `0.4S`, and P90 error is at most `0.75S`. If that fails but valid samples are at least 70% and median error is at most `0.8S`, show only a labelled rough heatmap and no AI advice; below that, show no gaze result. Align gaze samples and taps on the same monotonic clock; show a replay alongside the click timeline. Send only derived metrics to the feedback API, never video. Disable WebGazer cross-session calibration storage and release the camera after use.

## Done when

On both demo devices, a user can speak or type a task, correct and confirm it, reload and find it, finish a 5×5 round, and view gaze replay plus cautious written feedback after valid calibration. Permission denial, interrupted training, and failed validation leave ordinary tasks and training usable. Feedback shows the observation, one practical suggestion, confidence, a reviewed source, and a limitation; it makes no diagnosis or claim of general attention improvement.
