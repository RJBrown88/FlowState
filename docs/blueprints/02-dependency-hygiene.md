# Blueprint 2 — Dependency and naming hygiene

**Goal:** `package.json` lists only what the app uses, with each package in the right section, and the project is called FlowState everywhere instead of the AI Studio template names.

**Files:** `package.json`, `package-lock.json` (regenerated, never hand-edited), `index.html`, `README.md`, `vite.config.ts`, optionally `tsconfig.json` and `metadata.json`
**Size:** config only, no app logic changes
**Dependencies:** none. Phase 3 builds on the result.

---

## 2a. Remove unused packages

None of these is imported anywhere in `src/` or `vite.config.ts` (confirmed with `grep`):

| Package | Section now | Why it's there | Action |
|---------|-------------|----------------|--------|
| `express` | dependencies | AI Studio full-stack template | Remove |
| `better-sqlite3` | dependencies | Template | Remove. It also compiles native C++ during install, which is slow and can fail on hosts without build tools. |
| `dotenv` | dependencies | Template | Remove |
| `@types/express` | devDependencies | Template | Remove |
| `tsx` | devDependencies | Template (runs a TS server) | Remove |
| `autoprefixer` | devDependencies | Tailwind v3 habit | Remove. Tailwind v4's Vite plugin handles vendor prefixes itself, and there's no PostCSS config that would use it. |

### Phase 3 overlap
Phase 3 adds a server and needs Express again. Two options:

**[A] Remove everything now, Phase 3 adds back what it needs (recommended).** Phase 3 adds Express **5** (current major) rather than the template's Express 4. It needs neither `tsx` nor `dotenv`: Node 22 runs TypeScript files directly and loads env files with `--env-file-if-exists` (see Blueprint 3). Each phase's diff then shows exactly why each package exists.

**[B] Remove only `better-sqlite3` and `autoprefixer` now.** Less churn, but Express stays pinned to v4 and the leftovers stay until Phase 3 decides about them.

---

## 2b. Move build tools to devDependencies

These run only at build time but are listed as runtime dependencies:

- `vite` (also listed a second time in devDependencies — remove the duplicate)
- `@vitejs/plugin-react`
- `@tailwindcss/vite`

`tailwindcss` is already in devDependencies.

Why it matters: a production install (`npm ci --omit=dev`) currently installs the whole build toolchain. After Phase 3 there will be a production server, so this starts to matter.

### Gotcha
`npm install -D <pkg>` with no version installs the **latest** release, which would quietly upgrade vite from 6 to 8. Always pin to the existing range when moving a package:

```bash
npm uninstall express better-sqlite3 dotenv @types/express tsx autoprefixer
npm install -D vite@^6.2.0 @vitejs/plugin-react@^5.0.4 @tailwindcss/vite@^4.1.14
```

`npm install -D` on a package that is already in `dependencies` moves it to `devDependencies`. Both commands rewrite `package-lock.json`.

### Expected end state
```jsonc
{
  "name": "flowstate",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": { /* unchanged */ },
  "dependencies": {
    "@google/genai": "^1.29.0",
    "lucide-react": "^0.546.0",
    "motion": "^12.23.24",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.1.14",
    "@types/node": "^22.14.0",
    "@vitejs/plugin-react": "^5.0.4",
    "tailwindcss": "^4.1.14",
    "typescript": "~5.8.2",
    "vite": "^6.2.0"
  }
}
```

**Not in this phase:** major-version upgrades (vite 8, motion 14, lucide 1, TS 7, `@google/genai` 2). Those are in the roadmap backlog. `@google/genai` 2 is handled in Phase 4, where it's nearly free: its breaking changes affect only the Interactions API, not `generateContent`, which is all FlowState uses.

---

## 2c. Naming

| File | Now | Change to |
|------|-----|-----------|
| `package.json` `name` | `react-example` | `flowstate` |
| `package.json` `version` | `0.0.0` | `0.1.0` (optional — marks the first maintained version) |
| `index.html` `<title>` | `My Google AI Studio App` | `FlowState` |
| `index.html` | — | Add `<meta name="description">` using the line from `metadata.json` |
| `README.md` | AI Studio banner + boilerplate | See below |

### README outline
1. **FlowState** — one-line pitch (from `metadata.json`).
2. **How it works** — seed → association web → bars; the three settings (Density / Orbit / Grid) in one table.
3. **Run locally** — prerequisites (Node 22+), `npm install`, put the key in `.env.local`, `npm run dev`.
4. **Security note** — until Phase 3: "the key is bundled into the client; don't host builds."
5. **Project layout** — `src/App.tsx`, `src/services/geminiService.ts`, `src/lib/bars.ts`.

Phase 3 updates sections 3–5.

### `metadata.json` — decision needed
AI Studio reads this file. Keep it if you might re-import the project into AI Studio. Delete it if the GitHub repo is now the home of this project. Recommendation: **keep it for now.** It's harmless, and Phase 3 is the point to decide whether AI Studio is still a deploy target.

---

## 2d. Small cleanups

- **`vite.config.ts:20`** — the comment reads `Do not modifyâfile watching…`. That's a UTF-8 em-dash mis-decoded during export. Replace it with `Do not modify — file watching…` or a plain hyphen.
- **`tsconfig.json` (optional):**
  - `experimentalDecorators` and `useDefineForClassFields: false` — no decorators or classes in the code. Remove them.
  - `paths: { "@/*": ["./*"] }` and the matching `resolve.alias` in `vite.config.ts` — nothing imports `@/`. Remove both or keep both. Don't remove only one.
  - `allowJs` — there are no JS sources. Harmless, optional.

---

## Verification

1. `npm ls --depth=0` — no `express`, `better-sqlite3`, `dotenv`, `tsx`, `autoprefixer`, `@types/express`, and no `invalid`/`missing` lines.
2. `git diff package-lock.json` — packages are removed, but the **versions** of the remaining top-level packages are unchanged (vite stays 6.4.x).
3. `npm run lint` and `npm run build` pass. Bundle size should match the current 661 KB, since nothing in the browser changed.
4. `npm run dev` → the app loads, a verse generates, and the tab title reads "FlowState".
5. Fresh-install check: `rm -rf node_modules && npm ci` completes noticeably faster (no native compile from `better-sqlite3`).
