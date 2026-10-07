# FlowState

A technical freestyle lyric engine: give it a short seed phrase and it expands it into a rhythmic, beat-aligned verse using rhyme architecture and cadence control. Powered by Google Gemini.

## How it works

1. You type a **seed**, e.g. *rent is due*.
2. Gemini builds a silent association web around it (literal, sensory, metaphorical, sound-alike) and writes 12–16 bars.
3. Every bar has a breath mark (`//`), and every 4th bar calls back to the seed.

Three settings shape the verse:

| Setting | Low end | Middle | High end |
|---------|---------|--------|----------|
| **Density** — rhyme complexity | LOW: end rhymes, clear storytelling | MID: end rhymes + an internal rhyme per couplet | HIGH: internal rhymes every line, multi-syllable chains |
| **Orbit** — how far it drifts from the seed | TIGHT: literal, one-hop metaphors | MID: two-hop associations | LOOSE: full stream of consciousness |
| **Grid** — flow and cadence | POCKET: behind the beat, conversational | MID: standard hip-hop pacing | CHOPPER: rapid-fire, percussive |

An optional **tone** (e.g. *aggressive*, *melancholic*) colours the whole verse.

## Run locally

**Prerequisites:** Node.js 22.18 or newer (it runs the TypeScript server directly), and a Gemini API key.

```bash
npm install
cp .env.example .env.local    # then put your key in .env.local
npm run dev                   # http://localhost:3000
```

`npm run dev` starts one server that handles the API and serves the app with hot reload. It restarts by itself when server files change.

Other scripts: `npm run lint` (typecheck), `npm run build` (production build into `dist/`), `npm start` (serve that build in production mode).

## How the key stays private

The browser never talks to Gemini. It sends the seed and settings to this app's own server (`POST /api/verse`), and the server calls Gemini with the key from `.env.local` and streams the verse back. The key never appears in the files sent to the browser.

The server also validates requests, rate-limits each client (`RATE_LIMIT_PER_MINUTE`, default 10), and turns Gemini failures into short, readable messages. All settings are listed in `.env.example`.

## Self-hosting

Runs on any machine with Node 22.18+. There are two guides, both covering deploy, run-at-boot, smoke test and rollback:
- **Windows on a home LAN** (the current setup): [Blueprint 3 § Windows host](docs/blueprints/03-server-side-key.md#windows-host).
- **Linux with systemd**, optionally behind a reverse proxy: [Blueprint 3 § Self-hosting](docs/blueprints/03-server-side-key.md#self-hosting).

## Project layout

| Path | What |
|------|------|
| `src/App.tsx` | The whole UI: controls, streaming output, Stop button, error banner |
| `src/services/verseClient.ts` | Streams a verse from the server |
| `src/lib/bars.ts` | Splits the streamed verse into numbered bars and `//` segments |
| `server/index.ts` | Express server: `/api` routes, plus the app (Vite in dev, `dist/` in production) |
| `server/verse.ts` | `POST /api/verse`: validation, rate limit, Gemini streaming, error messages |
| `server/prompt.ts` | The system prompt and the per-request prompt |
| `server/config.ts` | All environment settings, checked at startup |
| `shared/verse.ts` | Setting values and limits used by both browser and server |
| `docs/` | [Roadmap](docs/ROADMAP.md), [blueprints](docs/blueprints/) and [action plan](docs/ACTION_PLAN.md) |
