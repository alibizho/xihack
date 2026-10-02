# Project conventions

- Use Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, etc.) with one concise sentence after the colon.
- Keep feature changes in the matching `src/features/` folder; coordinate edits to `src/App.tsx` or `src/style.css`.
- The training contributor owns `src/features/training/`, including the 5×5 Schulte game.
- The eye-tracking experiment lives in `src/features/eye-tracking/`; keep it independent of the Schulte game.
- Label all mock responses as demo data until backend integration is complete.
- Keep the UI mobile-first and in Simplified Chinese. Run `npm run build` and `npm test` before committing.
