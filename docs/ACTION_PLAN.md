# FlowState Action Plan

Last updated 2026-10-06.

The [roadmap](ROADMAP.md) says **what** and in what order. The [blueprints](blueprints/) say **how**. This file says **who does what, step by step**, and where the decision points are. Tick the boxes as you go.

---

## How work flows

- **Owners:** **Claude** works in a cloud session. It can write code, run lint, build and the automated checks, and push. It has no Gemini API key, no access to your browser, and no access to your server. **Rob** does anything that needs those, and approves every merge.
- **One pull request per phase.** Claude develops on its session branch and opens a PR into `main` when the phase's automated checks pass. Rob runs the manual checks, merges, and the next phase starts from the updated `main`.
- **Gate before every merge:** the blueprint's Verification section, plus the roadmap's shared gate (lint, build, browser smoke test, and from Phase 3 on, no key in `dist/`).
- **When a phase merges:** set its Status in the roadmap to *Done*.

```
Step 0 ─▶ Phase 1 ─┐
          Phase 2 ─┴▶ Phase 3 ─▶ First deploy ─▶ Phase 4
Host prep (Rob, any time) ──────────▲
```
Phases 1 and 2 are independent and can go in either order. Host prep runs in parallel with everything before the deploy.

---

## Step 0 — Housekeeping (before Phase 1)

`main` currently holds only the original import. The lockfile and all planning docs exist only on Claude's branch.

- [ ] **Claude:** open a PR bringing the lockfile and `docs/` into `main`.
- [ ] **Rob:** merge it.
- [ ] **Rob:** in GitHub → Settings → General, set the default branch to `main` if it isn't already. Delete the old `claude/…` branch once its PR is merged.

**Done when:** `main` contains `package-lock.json`, `docs/ROADMAP.md`, `docs/blueprints/` and this file.

---

## Decisions to make along the way

Each one blocks only the step listed. Recommended options are from the blueprints.

| # | Decision | Blocks | Recommended | Owner |
|---|----------|--------|-------------|-------|
| D1 | `//` rendering: every `//` is a caesura, or only the first | Phase 1 | Every `//` (1c-A) | Rob |
| D2 | Cap the bar entrance delay? | Phase 1 | Optional: Rob's taste (1d) | Rob |
| D3 | Rate limiter: package or hand-rolled | Phase 3 | `express-rate-limit` | Rob |
| D4 | How the app is reached: LAN / Caddy + HTTPS / tunnel | First deploy | **Answered: LAN only** | Rob |
| D5 | Host details: OS, CPU type, Node version | First deploy | **Answered: Windows, Ryzen 7 5800X, Node 22.18+** | Rob |
| D6 | Give the cloud session a Gemini key (as an environment secret) so Claude can run evals? | Phase 4 | Use a separate key with a low quota limit if yes | Rob |
| D7 | Default model and thinking level | End of Phase 4 | Decided by eval results | Rob |

**Defaults if unanswered:** Claude proceeds with the recommended option and states that in the PR, so the decision can still be changed at review.

---

## Phase 1 — UI bugs · [blueprint](blueprints/01-ui-bugs.md)

- [ ] **Claude:** add `src/lib/bars.ts` (`parseBars`).
- [ ] **Claude:** guard `handleSpit` against starting a second generation (1a).
- [ ] **Claude:** render bars from `parseBars` (fixes numbering, 1b) with the D1 caesura choice (1c), plus 1d if chosen.
- [ ] **Claude:** run the helper check, lint and build. Open the PR.
- [ ] **Rob:** manual checks in `npm run dev` with your key:
  - [ ] Hammer Enter during a generation → one coherent verse.
  - [ ] Bars number 01…N with no gaps.
  - [ ] A few CHOPPER runs → bars with two `//` show every segment.
- [ ] **Rob:** merge. Roadmap Status → Done.

---

## Phase 2 — Project hygiene · [blueprint](blueprints/02-dependency-hygiene.md)

- [ ] **Claude:** create and push the `ai-studio-original` tag on commit `b55d06a`. This goes first, before anything is deleted.
- [ ] **Claude:** move the build tools to devDependencies by hand, then run `npm install`. Confirm no `"version"` lines changed in the lockfile.
- [ ] **Claude:** rename the project (package, title, description meta), delete `metadata.json`, clean `.env.example`, remove the AI Studio HMR block, rewrite the README.
- [ ] **Claude:** optional `tsconfig.json` cleanup. Run lint, build, and the "no AI Studio references" grep. Open the PR.
- [ ] **Rob:** `npm install`, then `npm run dev` → the tab says FlowState, a verse generates, editing a file hot-reloads.
- [ ] **Rob:** merge. Roadmap Status → Done.

---

## Phase 3 — Server-side key · [blueprint](blueprints/03-server-side-key.md)

Larger phase. Claude builds it in reviewable commits inside one PR:

- [ ] **Claude — commit 1, settings and contracts:** `shared/verse.ts`, `server/config.ts`, `server/prompt.ts`.
- [ ] **Claude — commit 2, server:** `server/verse.ts` (validation, rate limit, streaming, error mapping, cancel on disconnect) and `server/index.ts` (health, 404, error handler, dev/prod serving). Express 4 → 5 and the rate limiter installed.
- [ ] **Claude — commit 3, client:** `src/services/verseClient.ts`. `App.tsx` gets the abort-controller guard, Stop button and error state. Remove `geminiService.ts`.
- [ ] **Claude — commit 4, config:** remove `define` from `vite.config.ts`, update scripts, `engines`, `tsconfig.json` flags, `.env.example`, README.
- [ ] **Claude:** automated verification that needs no key: lint, build, key-free bundle, health and 404 responses, malformed and invalid requests rejected as JSON, rate limit returns 429, startup fails cleanly without a key or with a bad `PORT`. Open the PR with the results.
- [ ] **Rob:** checks that need the key (`npm run dev`):
  - [ ] A verse streams in the browser.
  - [ ] Stop mid-verse keeps the partial text. The server log shows the cancel line.
  - [ ] A wrong key → a readable "API key is invalid" message.
  - [ ] `npm run build && npm start` → the app works in production mode, and refresh works.
- [ ] **Rob:** merge. Roadmap Status → Done.

---

## Host prep — Rob, any time before the deploy · [blueprint § Self-hosting](blueprints/03-server-side-key.md#self-hosting)

Host: **Windows, LAN only** (D4/D5 answered 2026-10-07). Steps in [Blueprint 3 § Windows host](blueprints/03-server-side-key.md#windows-host).

- [x] Answer D4 and D5.
- [ ] `node -v` shows v22.18.0 or newer. Git is installed.
- [ ] Choose the service wrapper: NSSM (recommended) or Task Scheduler. With NSSM, download it from nssm.cc.
- [ ] Home network is on the **Private** profile (`Get-NetConnectionProfile`). Add the firewall rule for port 3000 (Private only).
- [ ] Set sleep to Never on AC power. Reserve the PC's IP in the router (optional, but saves hunting for it).

---

## Milestone — First deploy · [blueprint § Self-hosting](blueprints/03-server-side-key.md#self-hosting)

Needs Phase 1, Phase 3 and host prep.

- [ ] **Rob:** clone `main` into `C:\apps\FlowState`, create `logs\`, and create `.env.local` with the key, `HOST=0.0.0.0` and `TRUST_PROXY=0`.
- [ ] **Rob:** run the deploy steps (`npm ci` → `npm run build` → `npm prune --omit=dev`).
- [ ] **Rob:** install and start the service (the NSSM commands in the blueprint).
- [ ] **Rob:** run the smoke test, including a PC restart, a verse streaming on a phone over Wi-Fi, and the no-key-in-bundle check.
- [ ] **Rob:** tag the deploy (`deploy-…`). Roadmap: First deploy → Done.

**If something fails:** `C:\apps\FlowState\logs\err.log` usually names the cause: missing env var, a Node path the service can't reach, or a port conflict. Paste it to Claude.

---

## Phase 4 — Model config · [blueprint](blueprints/04-model-config.md)

**Emergency trigger:** if verses start failing with "Model … is unavailable" before this phase, do only the first two boxes, deploy, and continue later.

- [ ] **Claude:** extend `server/config.ts` (`GEMINI_MODEL`, validated `GEMINI_THINKING_LEVEL`), add `/api/meta`, and drive both UI labels from it. Default unchanged.
- [ ] **Rob:** merge and deploy that slice (no behavior change, so low risk).
- [ ] **Claude:** write `scripts/eval.ts` and create `docs/eval-results.md`.
- [ ] **Rob, or Claude if D6 = yes:** look up the current model IDs on Google's models and deprecations pages. Pick 1–2 candidates.
- [ ] **Eval runs** (server started with `RATE_LIMIT_PER_MINUTE=100`), one variable at a time, each recorded in `docs/eval-results.md`:
  - [ ] Baseline: current model, SDK 1.x.
  - [ ] **Claude:** SDK bump to 2.x → re-run. Should match the baseline.
  - [ ] **Claude:** re-run at the default thinking level and at `LOW`. (`temperature` was already removed in Phase 3.)
  - [ ] Candidate model(s) → run.
- [ ] **Rob:** read the HIGH/LOOSE/CHOPPER verses side by side (the ~10-minute manual score). Make decision D7.
- [ ] **Claude:** set the chosen default, record the decision in `docs/eval-results.md`, open the PR.
- [ ] **Rob:** merge, deploy, roadmap Status → Done.

---

## After Phase 4

Pick from the roadmap backlog. A useful first one is the template-packages decision: keep `better-sqlite3` only if a saved-verses feature is actually planned.
