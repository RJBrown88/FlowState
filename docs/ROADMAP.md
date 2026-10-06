# FlowState Roadmap

Status as of 2026-10-06. Based on the code review of the original AI Studio export.

The app installs, typechecks, builds and passes `npm audit` today. The work below is cleanup and hardening, not rescue.

## Phases

| # | Phase | Size | Risk | Depends on | Blueprint |
|---|-------|------|------|------------|-----------|
| 1 | Fix the Enter-key race and bar rendering | ~15 lines | Very low | — | [01-ui-bugs.md](blueprints/01-ui-bugs.md) |
| 2 | Dependency and naming hygiene | Config only | Low | — | [02-dependency-hygiene.md](blueprints/02-dependency-hygiene.md) |
| 3 | Move the API key server-side | New server (~120 lines), client rewrite of one file | Medium | 2 | [03-server-side-key.md](blueprints/03-server-side-key.md) |
| 4 | Stable model, one source of truth | ~40 lines | Low code risk, medium output risk | 3 (soft) | [04-model-config.md](blueprints/04-model-config.md) |

## Why this order

1. **Phase 1 first** because it is two isolated bugs in `src/App.tsx` with no dependency changes. It's quick and visible, and it gives a clean baseline before anything structural moves.
2. **Phase 2 before 3** because Phase 3 adds a server and new packages. Starting from a clean `package.json` makes the Phase 3 diff show only what the server actually needs, instead of mixing it with template leftovers.
3. **Phase 3 before 4** because Phase 3 moves the Gemini call from the browser to the server. Phase 4 changes that same call (model ID, generation settings). Doing 4 first means editing the call in the browser and then moving it, which is the same work done twice.
   - If Phase 3 is postponed, Phase 4 still works on its own: apply it to `src/services/geminiService.ts` instead of the server file.

## Hard rule until Phase 3 ships

Do **not** host a build made with a real `GEMINI_API_KEY`. The current `vite.config.ts` writes the key into the JavaScript bundle, where any visitor can read it.

## Items folded into phases

These came up in the review and fit naturally inside a phase, so they don't get their own:

| Item | Lands in |
|------|----------|
| Text after a second `//` is dropped | Phase 1 |
| Garbled character in a `vite.config.ts` comment | Phase 2 |
| Generic package name, page title, README | Phase 2 |
| Uncommitted lockfile | Done (committed `47d7022`) |
| No way to cancel a generation | Phase 3 |
| Real error messages hidden behind "ENGINE STALLED" | Phase 3 |
| 661 KB bundle (Gemini SDK shipped to the browser) | Phase 3 |
| Model name typed in three places | Phase 4 |
| `temperature: 0.9` (Google advises the default for Gemini 3) | Phase 4 |

## Backlog (after Phase 4, not scheduled)

- **Major upgrades:** vite 6→8, `@vitejs/plugin-react` 5→6, motion 12→14, lucide-react 0.x→1.x, TypeScript 5.8→7. Do each one separately, with a build and a manual check between them.
- **Tooltips:** they work on mouse hover only. Add focus and touch support, or show the description inline under the selected option.
- **Tests:** add Vitest for the pure helpers that Phase 1 extracts (`parseBars`) and the request validation added in Phase 3.
- **Mobile layout:** check that the verse output scrolls on a phone. `main` uses `overflow-hidden` with a one-column grid below the `lg` breakpoint.
- **Decorative footer:** the coordinates, "System Online" and version number are fake. Keep them or make them real (the version could be read from `package.json`).

## Branching

The action plan will decide this. Default proposal: one commit per phase, each verified (`npm run lint`, `npm run build`, manual smoke test) before moving on.
