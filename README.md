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

**Prerequisites:** Node.js 22 or newer, and a Gemini API key.

```bash
npm install
cp .env.example .env.local    # then put your key in .env.local
npm run dev                   # http://localhost:3000
```

Other scripts: `npm run lint` (typecheck), `npm run build` (production build into `dist/`), `npm run preview` (serve that build).

## Security note

For now the API key is **bundled into the browser code** at build time, so anyone who can load the page can read it. Use this for local development only and don't host a build. Moving the key to a server is Phase 3 of the [roadmap](docs/ROADMAP.md).

## Project layout

| Path | What |
|------|------|
| `src/App.tsx` | The whole UI: controls, streaming output, bar rendering |
| `src/services/geminiService.ts` | The system prompt and the streaming Gemini call |
| `src/lib/bars.ts` | Splits the streamed verse into numbered bars and `//` segments |
| `docs/` | [Roadmap](docs/ROADMAP.md), [blueprints](docs/blueprints/) and [action plan](docs/ACTION_PLAN.md) |
