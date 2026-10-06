# Blueprint 3 — Move the API key server-side

**Goal:** the Gemini API key never reaches the browser. The browser talks to a small Node server, and the server talks to Gemini. Along the way the app gains a Stop button, real error messages and a much smaller bundle.

**Files:**
- New: `server/index.ts`, `server/verse.ts`, `server/prompt.ts`, `shared/verse.ts`, `src/services/verseClient.ts`
- Changed: `src/App.tsx`, `vite.config.ts`, `package.json`, `tsconfig.json`, `.env.example`, `README.md`
- Deleted: `src/services/geminiService.ts` (its contents move to `server/` and `shared/`)

**Size:** ~150 new lines, ~40 changed in `App.tsx`
**Depends on:** Phase 2 (clean `package.json`)

---

## Why it's needed

`vite.config.ts:10–12`:
```ts
define: { 'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY) }
```
`define` is a find-and-replace done at build time. Every occurrence of `process.env.GEMINI_API_KEY` in the client code becomes the literal key string in `dist/assets/index-*.js`. Anyone who opens the page can read it from DevTools and use your quota. AI Studio avoids this by swapping the key in behind the scenes. A self-hosted build doesn't.

No setting fixes this from the client side. If the browser can call Gemini directly, the browser has the key. The call has to move to a server.

---

## Architecture

```
Browser                         Node server (Express 5)                Gemini
───────                         ───────────────────────                ──────
App.tsx
  └─ verseClient.streamVerse ──POST /api/verse {seed,…}──▶ validate
                                                            rate-limit
                                                            build prompt
                                                            generateContentStream ──▶
     ◀── NDJSON lines {"text":…}… {"done":true} ◀────────── forward chunks ◀────────
  Stop button ── AbortController ── fetch aborted ──▶ res 'close' ── abortSignal ──▶ (cancelled)
```

### Server shape: options

**[A] One process, Vite inside Express (recommended).** In dev, Express mounts Vite as middleware (hot reload still works). In production, Express serves the built `dist/`. One port and one command, and dev behaves like prod. This is also the layout AI Studio's own full-stack template uses.

**[B] Two processes: Vite dev server + separate API server.** Vite proxies `/api` to the API server. The server code is slightly simpler, but you run two terminals (or add `concurrently`), and production still needs something to serve `dist/`, which ends up looking like [A] anyway.

The rest of this blueprint assumes [A].

### Response format: NDJSON
The server answers with one JSON object per line (`application/x-ndjson`):
```
{"text":"Concrete jungle // where the"}
{"text":" pigeons pay rent\n"}
{"done":true}
```
or, if Gemini fails mid-stream, `{"error":"…"}` as the last line.

**Why not plain text?** Once the first chunk is sent, the HTTP status is already 200. Plain text can't signal "the stream broke halfway". With NDJSON the client can tell an error, a clean finish and a dropped connection apart.

**Why not Server-Sent Events?** The browser's `EventSource` only does GET requests, so you'd end up parsing SSE by hand from `fetch` anyway. NDJSON is simpler to parse by hand.

### Running TypeScript on the server without a build step
Node 22.18+ strips TypeScript types natively (this repo's container has 22.22). So:
- dev: `node --watch --env-file-if-exists=.env.local server/index.ts`
- prod: `node --env-file-if-exists=.env.local server/index.ts`

No `tsx`, no `ts-node`, no compile step. Rules this imposes, enforced by two `tsconfig.json` flags (below):
- relative imports need the `.ts` extension (`./verse.ts`). This is already allowed by `allowImportingTsExtensions`;
- type-only imports must be written `import type { … }`;
- no `enum`, `namespace` or constructor parameter properties (syntax that can't simply be deleted).

`--env-file-if-exists` (Node 22.9+) replaces `dotenv`.

---

## File by file

### `shared/verse.ts` — used by both client and server
```ts
export const DENSITIES = ['LOW', 'MID', 'HIGH'] as const;
export const ORBITS = ['TIGHT', 'MID', 'LOOSE'] as const;
export const GRIDS = ['POCKET', 'MID', 'CHOPPER'] as const;

export type Density = (typeof DENSITIES)[number];
export type Orbit = (typeof ORBITS)[number];
export type Grid = (typeof GRIDS)[number];

export interface VerseConfig {
  seed: string;
  density: Density;
  orbit: Orbit;
  grid: Grid;
  tone?: string;
}

export const LIMITS = { seed: 200, tone: 60 } as const;
```
The value arrays let the server validate against the same lists the UI renders. `App.tsx` can use them in place of its inline `['LOW','MID','HIGH'] as Density[]` casts.

### `server/prompt.ts`
- `SYSTEM_INSTRUCTION`: moved verbatim from `geminiService.ts`.
- `buildPrompt(config)`: same template, with one change. Put the seed in with `JSON.stringify(config.seed)` instead of `"${config.seed}"`. A seed containing `"` can then no longer break out of its quotes and pose as another field (`DENSITY: …`). It's low stakes, but it's free.

### `server/verse.ts` — the `/api/verse` route
1. **Validate** `req.body` into a `VerseConfig`, or respond `400 {"error":"…"}`:
   - `seed`: a string, non-empty after trimming, at most `LIMITS.seed` characters;
   - `density`, `orbit`, `grid`: must be in the shared arrays;
   - `tone`: optional string, at most `LIMITS.tone` characters.
2. **Rate limit**: options:
   - **[A] `express-rate-limit` (recommended):** `rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false })`. Maintained, handles response headers, one dependency.
   - **[B] Hand-rolled:** a `Map<ip, timestamps[]>`, ~15 lines, no dependency, but you own the edge cases.

   Behind a reverse proxy (Cloud Run, nginx, Cloudflare), set `app.set('trust proxy', 1)`, or every visitor shares the proxy's IP and one limit.
3. **Cancel on disconnect:**
   ```ts
   const controller = new AbortController();
   res.on('close', () => { if (!res.writableEnded) controller.abort(); });
   ```
   Listen on `res`, not `req`. On current Node, `req` emits `close` as soon as the request body has been read, which would cancel every request immediately.
4. **Stream:**
   ```ts
   res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
   res.setHeader('Cache-Control', 'no-cache');
   res.setHeader('X-Accel-Buffering', 'no'); // stop nginx-style proxies from buffering

   const stream = await ai.models.generateContentStream({
     model: MODEL_ID,
     contents: [{ role: 'user', parts: [{ text: buildPrompt(config) }] }],
     config: { systemInstruction: SYSTEM_INSTRUCTION, temperature: 0.9, abortSignal: controller.signal },
   });
   for await (const chunk of stream) {
     if (chunk.text) res.write(JSON.stringify({ text: chunk.text }) + '\n');
   }
   res.end(JSON.stringify({ done: true }) + '\n');
   ```
   Headers are set but not flushed before the `await`. If Gemini rejects the request before the first chunk (bad key, unknown model), the route can still answer with a proper status code.
5. **Errors:** if `controller.signal.aborted`, return silently (the user pressed Stop). Otherwise, map `ApiError.status` (exported by `@google/genai`) to a short message and log the full error on the server:

   | Gemini status | Client message | Likely cause |
   |---|---|---|
   | 400 | "Gemini rejected the request." | Prompt/config problem |
   | 401 / 403 | "Server API key is invalid or lacks access." | Key wrong or revoked |
   | 404 | "Model `<id>` is unavailable." | **Preview model shut down** — see Phase 4 |
   | 429 | "Gemini quota exceeded — try again shortly." | Quota |
   | 5xx / other | "Gemini is having trouble — try again." | Upstream |

   If no chunk has been sent yet (`!res.headersSent`), respond with `res.status(502).json({ error })`. Otherwise `res.end(JSON.stringify({ error }) + '\n')`.

`MODEL_ID` is a constant here for now. Phase 4 moves it to config.

### `server/index.ts`
```ts
import express from 'express';
import path from 'node:path';
import { verseRouter } from './verse.ts';

if (!process.env.GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY is not set (put it in .env.local)');
  process.exit(1);
}

const isProd = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT ?? 3000);
const app = express();

app.use('/api', express.json({ limit: '4kb' }), verseRouter);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

if (isProd) {
  const dist = path.join(import.meta.dirname, '..', 'dist');
  app.use(express.static(dist));
  app.get('/{*splat}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
} else {
  const { createServer } = await import('vite'); // dynamic: vite is a devDependency
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}

app.listen(port, '0.0.0.0', () => console.log(`FlowState on http://localhost:${port}`));
```
Notes:
- Vite is imported dynamically so a production install (`npm ci --omit=dev`) doesn't need it.
- `/{*splat}` is Express 5's catch-all syntax. Express 4's `*` throws on startup in v5.
- The `/api` 404 handler stops unknown API paths from falling through to `index.html` in production.
- The 4 KB body limit is generous: the largest valid request is ~300 bytes.

### `src/services/verseClient.ts` — replaces `geminiService.ts`
Same async-generator shape as the old `generateVerse`, so `App.tsx`'s `for await` loop keeps working:
```ts
import type { VerseConfig } from '../../shared/verse.ts';

export async function* streamVerse(config: VerseConfig, signal?: AbortSignal) {
  const res = await fetch('/api/verse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
    signal,
  });
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Server error (${res.status})`);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let finished = false;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let nl: number;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.error) throw new Error(msg.error);
      if (msg.done) finished = true;
      if (msg.text) yield msg.text as string;
    }
  }
  if (!finished) throw new Error('Connection dropped before the verse finished.');
}
```
Lines are buffered until the newline because network chunks don't line up with JSON lines. One `read()` can hold half a line or three lines.

### `src/App.tsx`
- **Import** `streamVerse` and the shared types (`import type`).
- **Abort controller ref:** `const abortRef = useRef<AbortController | null>(null);`
  - `handleSpit`: return early if `abortRef.current` is set (this replaces Phase 1's `isSpitting` guard and can't be fooled by render timing). Create a controller, store it, pass `controller.signal`, and clear the ref in `finally`.
  - Clean up on unmount: `useEffect(() => () => abortRef.current?.abort(), [])`.
- **Stop button:** while generating, the main button becomes **STOP** (enabled) and calls `abortRef.current?.abort()`. The partial verse stays on screen.
- **Error state:** add `const [error, setError] = useState<string | null>(null)`. Today the error text is written *into* `verse` and rendered as bar 01. Instead:
  - an `AbortError` (`err.name === 'AbortError'`) → not an error, leave the partial verse alone;
  - anything else → `setError(err.message)`, shown in the status bar or as a banner styled with the neon-pink border;
  - clear `error` at the start of each generation.

### `vite.config.ts`
Delete the `define` block and the `loadEnv` call. The client no longer needs any environment value. Keep the `hmr` / `DISABLE_HMR` block.

### `package.json`
```jsonc
"engines": { "node": ">=22.18" },
"scripts": {
  "dev": "node --watch --env-file-if-exists=.env.local server/index.ts",
  "build": "vite build",
  "start": "NODE_ENV=production node --env-file-if-exists=.env.local server/index.ts",
  "lint": "tsc --noEmit"
}
```
Add: `express@^5`, `express-rate-limit@^8` (dependencies); `@types/express@^5` (devDependencies). `@google/genai` stays in dependencies, but it's now only used by the server.

`node --watch` restarts the server when server files change. Client changes are still hot-reloaded by Vite without a restart.

### `tsconfig.json`
Add:
- `"erasableSyntaxOnly": true` — tsc rejects syntax Node can't strip (TS 5.8+);
- `"verbatimModuleSyntax": true` — tsc requires `import type` for type-only imports. `App.tsx`'s current mixed import `{ generateVerse, VerseConfig, Density, … }` will be flagged, and that's expected: it gets rewritten in this phase anyway.

No `include` change: with no `include` set, tsc already checks `server/` and `shared/`.

### `.env.example`
```bash
# Server-side only. Never exposed to the browser.
GEMINI_API_KEY="your-key-here"
# Optional
PORT=3000
```
Drop `APP_URL` unless you're still deploying through AI Studio.

---

## Verification

1. `npm run lint`, `npm run build` pass.
2. **Key absent from the bundle:**
   ```bash
   grep -rc "AIza" dist/ | grep -v ':0'                          # Google keys start with AIza; expect no output
   grep -rF "$(grep GEMINI_API_KEY .env.local | cut -d'"' -f2)" dist/ # expect no output
   ```
3. **Bundle size** drops well below today's 661 KB, because the Gemini SDK is no longer shipped to the browser. Record the new figure.
4. **API checks** (with `npm run dev` running):
   ```bash
   # streams NDJSON lines, ends with {"done":true}
   curl -N -X POST localhost:3000/api/verse -H 'Content-Type: application/json' \
     -d '{"seed":"rent is due","density":"MID","orbit":"MID","grid":"MID"}'
   # 400: bad enum
   curl -s -X POST localhost:3000/api/verse -H 'Content-Type: application/json' \
     -d '{"seed":"x","density":"EXTREME","orbit":"MID","grid":"MID"}'
   # 400: seed too long
   # 429: 11 requests inside a minute
   # 404 JSON: curl -s localhost:3000/api/nope
   ```
   Ctrl-C a `curl -N` mid-stream → the server logs nothing alarming, and the Gemini request is cancelled (no further chunks are processed).
5. **Bad key:** set `GEMINI_API_KEY=nope` → the UI shows "Server API key is invalid…", not "ENGINE STALLED".
6. **UI:** Stop mid-verse keeps the partial text. Enter during a generation does nothing. A new generation clears an old error.
7. **Production mode:** `npm run build && npm start` → `localhost:3000` serves the app, and refreshing works.

---

## Decision needed before starting: where will it be hosted?

The code above runs on any Node 22.18+ host. What changes per host is `trust proxy`, how the env var is set, and the port:
- **AI Studio / Cloud Run:** env var set in the console, `PORT` provided by the platform, `trust proxy` on.
- **A home server / Proxmox LXC:** `npm ci --omit=dev && npm run build && npm start` under systemd. Behind nginx or Caddy → `trust proxy` on. Exposed directly → off.
- **Render / Fly / Railway:** same as Cloud Run.
- **Not hosted (local only):** this phase is still worth doing for the Stop button and error handling, but it stops being urgent.
