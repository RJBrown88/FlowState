# Blueprint 4 — Stable model, one source of truth

**Goal:** the model is set in exactly one place, can be changed without a code change, and the app survives Google retiring it. The new model choice is backed by a small evaluation instead of a guess.

**Files:** new `server/config.ts`, new `scripts/eval.ts`; changed `server/verse.ts`, `src/App.tsx`, `package.json`, `.env.example`
**Size:** ~40 lines of app changes + ~100-line eval script
**Depends on:** Phase 3 (soft). Without Phase 3, apply the same ideas to `src/services/geminiService.ts` and use a Vite `import.meta.env.VITE_GEMINI_MODEL` instead of a server env var.

---

## Current state

| Where | What |
|---|---|
| `src/services/geminiService.ts:73` | `model: "gemini-3.1-pro-preview"` |
| `src/services/geminiService.ts:77` | `temperature: 0.9` |
| `src/App.tsx:110` | Marquee text `… // Gemini 3.1 Pro // …` |
| `src/App.tsx:251` | Status bar `Engine: Gemini 3.1 Pro` |

Two problems:
1. **It's a preview model.** Google retires preview models on a few weeks' notice: `gemini-3-pro-preview` was shut down on 2026-03-09 and replaced by the 3.1 preview this app uses. When this one is retired, every request fails, and the app currently shows only "ENGINE STALLED".
2. **The name is written in three places.** Changing the model means editing code in two files, and the UI labels can drift from the model actually in use.

---

## 4a. One source of truth

### `server/config.ts`
```ts
export const MODEL_ID = process.env.GEMINI_MODEL ?? '<chosen default — see 4c>';
export const THINKING_LEVEL = process.env.GEMINI_THINKING_LEVEL; // undefined = model default
```
`server/verse.ts` imports `MODEL_ID` in place of its Phase 3 constant.

### Getting the name to the UI: options

**[A] `GET /api/meta` (recommended):** the server returns `{ "model": MODEL_ID }`. `App.tsx` fetches it once on mount and shows it in both places. If the env var changes, the UI follows automatically. Costs one tiny request and a placeholder (`Engine: …`) for a few milliseconds.

**[B] Shared constant in `shared/model.ts`:** the client and server both import it. There's no extra request, but there's also no env override: changing the model means a code change and a rebuild, which is what this phase is trying to remove.

### Label format
Show the raw ID (`GEMINI-3.5-FLASH` once the marquee uppercases it) rather than a hand-written "friendly" name. It's always accurate and needs no upkeep. If you'd rather have a nicer name, add an optional `GEMINI_MODEL_LABEL` env var that `/api/meta` prefers when set.

---

## 4b. Generation settings

### Temperature: remove the `0.9`
Google's Gemini 3 developer guide strongly recommends leaving `temperature` at its default of **1.0**. Values below 1.0 can cause **looping**, which here means repeated bars, and degraded output. The 0.9 was a pre-Gemini-3 habit. Delete the line. Don't set 1.0 explicitly either: if a future model has a different default, it should apply.

### Thinking level: make it tunable
Gemini 3 models reason before answering, and the default level is HIGH. For FlowState that's a real trade-off:
- **For HIGH:** rule 1 of the system prompt ("silently build an association web") is exactly the kind of planning thinking helps with, and quality on DENSITY=HIGH (multi-syllable rhymes) probably depends on it.
- **Against HIGH:** thinking happens *before* the first streamed token, so the screen sits at "Igniting…" for a noticeable time.

Set it with `GEMINI_THINKING_LEVEL` (passed as `config.thinkingConfig.thinkingLevel` when set). Let the eval (4d) decide the default. Note that the accepted values differ by model (Pro models have taken `LOW`/`HIGH`; Flash also `MINIMAL`/`MEDIUM`). An unsupported value comes back as a 400, which Phase 3 already turns into a readable error.

---

## 4c. Choosing the default model

> **Verification gate:** I couldn't reach Google's model list from this environment, so the IDs below come from search results as of 2026-10-06. **Confirm each ID on <https://ai.google.dev/gemini-api/docs/models> and its status on <https://ai.google.dev/gemini-api/docs/deprecations> before picking one.**

| Option | Example ID | Pros | Cons |
|---|---|---|---|
| **Stay on Pro preview** | `gemini-3.1-pro-preview` | Strongest reasoning, and the current output quality you know | Will be retired. A 404 now shows a clear error (Phase 3) and is fixed with one env var change, but there's still downtime until you notice. |
| **Pinned stable Flash** | `gemini-3.5-flash` (or the newest stable Flash listed) | Won't disappear without a long deprecation window. Faster first token, cheaper. | Wordplay quality on DENSITY=HIGH is unknown, so it needs the eval. |
| **Auto-updating alias** | `gemini-flash-latest` | Never 404s from a retirement | Output style can change overnight with no code change, which is hard to debug when your verses suddenly sound different. |

**Recommendation:** default to a **pinned stable** ID in `server/config.ts`, and use `GEMINI_MODEL` to run the Pro preview while it lasts, if the eval says it's clearly better. That way the fallback is always a model that won't disappear.

---

## 4d. Evaluation script: `scripts/eval.ts`

A model swap changes the product's output, not just its plumbing, so it should be checked rather than eyeballed once.

### What it does
1. Calls the running server's `/api/verse`, so it tests the real prompt and config path.
2. Runs a fixed grid: **6 seeds × 3 setting combos × each candidate model**. The model is switched by restarting the server with a different `GEMINI_MODEL`, or by adding an optional `model` override to the request, accepted only when `NODE_ENV !== 'production'`.
   - Seeds: `rent is due`, `midnight oil`, `glass ceiling`, `static on the line`, `borrowed time`, `paper planes`
   - Combos: `LOW/TIGHT/POCKET`, `MID/MID/MID`, `HIGH/LOOSE/CHOPPER`
3. Saves every verse to `eval-out/<model>/<seed>-<combo>.txt` (gitignored) for reading.
4. Prints a table of **automatic checks** per model:

| Check | Rule source | How |
|---|---|---|
| Bar count 12–16 | Prompt rule 8 | `parseBars(verse).length` (Phase 1 helper) |
| Every bar has a caesura | Rule 2 | every bar has ≥ 2 segments |
| Exactly one caesura | Rule 2 | share of bars with exactly 2 segments |
| No numbering or preamble | Rule 8 | no line matching `/^\s*(\d+[.)]|#|\*\*)/`; first line contains `//` |
| Half-line length 6–12 syllables | Rule 2 | rough vowel-group syllable count, reported as % in range (approximate) |
| Time to first token | UX | ms from request to first `text` line |
| Total time | UX | ms to `done` |

5. **Manual scoring** for what code can't judge: read the HIGH/LOOSE/CHOPPER verses side by side and rate rhyme density and seed callbacks every 4th bar (rule 3) on a 1–3 scale. This is a ~10-minute read.

### Cost
6 × 3 × 2 models = 36 requests per run, ~1 minute and a few cents. Running it with the default thinking level and with `LOW` doubles that and answers 4b at the same time.

### Script entry
`"eval": "node scripts/eval.ts"` in `package.json`. Add `eval-out/` to `.gitignore`.

---

## 4e. SDK upgrade: `@google/genai` 1.x → 2.x

Do it in this phase, because it touches the same call. According to the SDK changelog, the 2.0.0 breaking changes are **limited to the Interactions API**, and `generateContent` / `generateContentStream` are unaffected. FlowState uses only the latter, so this should be a version bump with no code changes:
```bash
npm install @google/genai@^2.27.0
```
Run the eval once **before** and once **after** the bump with the same model. Matching pass rates confirm the SDK change is harmless before the model change is layered on top.

---

## Order of operations within this phase

1. Add `server/config.ts` and `/api/meta`, and wire the UI labels. **No behavior change yet** (default = current preview ID).
2. Write `scripts/eval.ts` and get a baseline on the current model.
3. Bump the SDK and re-run the eval. It should match the baseline.
4. Remove `temperature`. Run the eval with the default thinking level and with `LOW`.
5. Run the eval on the candidate stable model(s). Pick the default and the thinking level, and record the results table in the commit message or in `docs/`.

Each step is its own commit, so any regression can be traced to one change.

---

## Verification

1. `grep -rn "gemini-3\|Gemini 3" src/ server/ shared/` → only `server/config.ts` matches.
2. `GEMINI_MODEL=<other-id> npm run dev` → the marquee and status bar show `<other-id>`, and verses come from it (check the server log).
3. `GEMINI_MODEL=gemini-does-not-exist npm run dev` → generating shows "Model `gemini-does-not-exist` is unavailable." (Phase 3's 404 mapping). This is the dress rehearsal for the preview's retirement.
4. Eval: the chosen default passes ≥ 90 % of bars on caesura and bar-count checks across the grid, and its time to first token is recorded.
5. `npm run lint`, `npm run build` pass.

## Sources
- Gemini 3 developer guide (temperature 1.0, thinking level): <https://ai.google.dev/gemini-api/docs/gemini-3>
- Model list and deprecations: <https://ai.google.dev/gemini-api/docs/models>, <https://ai.google.dev/gemini-api/docs/deprecations>
- `@google/genai` changelog, v2.0.0 entry: <https://github.com/googleapis/js-genai/blob/main/CHANGELOG.md>
