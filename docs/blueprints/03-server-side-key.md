# Blueprint 3 — Move the API key server-side

**Goal:** the Gemini API key never reaches the browser. The browser talks to a small Node server, and the server talks to Gemini. Along the way the app gains a Stop button, real error messages and a much smaller bundle.

- **Roadmap:** Phase 3 · size L · exit criteria in [ROADMAP § Done when](../ROADMAP.md#done-when). The **Self-hosting** section at the end also covers the *First deploy* milestone.
- **Files:**
  - New: `server/config.ts`, `server/index.ts`, `server/verse.ts`, `server/prompt.ts`, `shared/verse.ts`, `src/services/verseClient.ts`
  - Changed: `src/App.tsx`, `vite.config.ts`, `package.json`, `tsconfig.json`, `.env.example`, `README.md`
  - Deleted: `src/services/geminiService.ts` (its contents move to `server/` and `shared/`)
- **Depends on:** Phase 2 (settled `package.json`). Phase 1 should land first so the guard and bar fixes carry over.
- **Used later by:** Phase 4 extends `server/config.ts` and the `/api` surface.
- **Priority:** required before the first self-hosted deploy. Even on a LAN-only box, anyone on the network (guest Wi-Fi included) could read the key out of the bundle.

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

**[A] One process, Vite inside Express (recommended).** In dev, Express mounts Vite as middleware (hot reload still works). In production, Express serves the built `dist/`. One port and one command, and dev behaves like prod.

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
- dev: `node --watch-path=server --watch-path=shared --env-file-if-exists=.env.local server/index.ts`
- prod: `node --env-file-if-exists=.env.local server/index.ts`

No compile step, and nothing extra to install. `tsx` and `dotenv` stay in `package.json` (kept from the template per the Phase 2 decision) but aren't needed here. Rules this imposes, enforced by two `tsconfig.json` flags (below):
- relative imports need the `.ts` extension (`./verse.ts`). This is already allowed by `allowImportingTsExtensions`;
- type-only imports must be written `import type { … }`;
- no `enum`, `namespace` or constructor parameter properties (syntax that can't simply be deleted).

`--env-file-if-exists` (Node 22.9+) does what `dotenv` would. On the production box systemd's `EnvironmentFile=` sets the variables instead (see **Self-hosting**), and the flag is then a harmless no-op.

---

## File by file

### `server/config.ts` — the only file that reads `process.env`
Every setting is read and checked in one place, at startup. A typo in `.env.local` then fails loudly at boot instead of misbehaving later, and Phase 4 has one obvious file to extend.
```ts
function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer, got "${raw}"`);
  return n;
}

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('GEMINI_API_KEY is not set (put it in .env.local)');
  process.exit(1);
}

export const config = {
  apiKey,
  isProd: process.env.NODE_ENV === 'production',
  port: int('PORT', 3000),
  host: process.env.HOST || '0.0.0.0',
  trustProxy: int('TRUST_PROXY', 0),           // number of reverse proxies in front (0 = none)
  rateLimitPerMinute: int('RATE_LIMIT_PER_MINUTE', 10),
  modelId: 'gemini-3.1-pro-preview',           // unchanged from today; Phase 4 makes it configurable
} as const;
```
Why the key check lives here and not in `index.ts`: ES module imports run before the importing file's own code. A check in `index.ts` would run *after* `verse.ts` had already been loaded with a missing key.

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
   - **[A] `express-rate-limit` (recommended):** `rateLimit({ windowMs: 60_000, limit: config.rateLimitPerMinute, standardHeaders: 'draft-8', legacyHeaders: false })`. Maintained, handles response headers, one dependency.
   - **[B] Hand-rolled:** a `Map<ip, timestamps[]>`, ~15 lines, no dependency, but you own the edge cases.

   Behind a reverse proxy (Caddy, nginx, Cloudflare Tunnel), set `TRUST_PROXY=1`, or every visitor shares the proxy's IP and one limit. The limit itself is configurable (`RATE_LIMIT_PER_MINUTE`). Phase 4's eval raises it temporarily, because it sends dozens of requests in a minute.
3. **Cancel on disconnect:**
   ```ts
   const controller = new AbortController();
   res.on('close', () => { if (!res.writableEnded) controller.abort(); });
   ```
   Listen on `res`, not `req`. On current Node, `req` emits `close` as soon as the request body has been read, which would cancel every request immediately.
   Log one line on abort (`client disconnected, generation cancelled`). That's how the verification step can see cancellation actually happened.
4. **Stream:**
   ```ts
   res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
   res.setHeader('Cache-Control', 'no-cache');
   res.setHeader('X-Accel-Buffering', 'no'); // stop nginx-style proxies from buffering

   const stream = await ai.models.generateContentStream({
     model: config.modelId,
     contents: [{ role: 'user', parts: [{ text: buildPrompt(config) }] }],
     config: { systemInstruction: SYSTEM_INSTRUCTION, abortSignal: controller.signal },
   });
   for await (const chunk of stream) {
     if (chunk.text) res.write(JSON.stringify({ text: chunk.text }) + '\n');
   }
   res.end(JSON.stringify({ done: true }) + '\n');
   ```
   `ai` is one `new GoogleGenAI({ apiKey: config.apiKey })` created when the module loads, not one per request. No `temperature` (or `top_p` / `top_k`): the original client sent `temperature: 0.9`, but Google's deprecation notice of 2026-10-07 says upcoming models will reject sampling parameters with a 400. Leaving it in would break Phase 4's emergency path (switching `GEMINI_MODEL` to a newer model). Output moves from 0.9 to the default 1.0, which Google already recommended for Gemini 3.
   Headers are set but not flushed before the `await`. If Gemini rejects the request before the first chunk (bad key, unknown model), the route can still answer with a proper status code.
5. **Errors:** if `controller.signal.aborted`, return silently (the user pressed Stop). Otherwise, map `ApiError.status` (exported by `@google/genai`) to a short message and log the full error on the server:

   | Gemini status | Client message | Likely cause |
   |---|---|---|
   | 400 | "Gemini rejected the request." | Prompt/config problem |
   | 401 / 403, or 400 mentioning the API key | "Server API key is invalid or lacks access." | Key wrong or revoked. Google reports an invalid key as **400** `INVALID_ARGUMENT`, so a status-only mapping would miss it. |
   | 404 | "Model `<id>` is unavailable." | **Preview model shut down** — see Phase 4 |
   | 429 | "Gemini quota exceeded — try again shortly." | Quota |
   | 5xx / other | "Gemini is having trouble — try again." | Upstream |

   If no chunk has been sent yet (`!res.headersSent`), respond with `res.status(502).json({ error })`. Otherwise `res.end(JSON.stringify({ error }) + '\n')`.

`config.modelId` is a fixed value for now. Phase 4 makes it an env setting.

### `server/index.ts`
```ts
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import path from 'node:path';
import { config } from './config.ts';
import { verseRouter } from './verse.ts';

const app = express();
if (config.trustProxy > 0) app.set('trust proxy', config.trustProxy);

app.get('/api/health', (_req, res) => { res.json({ ok: true }); });
app.use('/api', express.json({ limit: '4kb' }), verseRouter);
app.use('/api', (_req, res) => { res.status(404).json({ error: 'Not found' }); });

if (config.isProd) {
  const dist = path.join(import.meta.dirname, '..', 'dist');
  app.use(express.static(dist));
  app.get('/{*splat}', (_req, res) => { res.sendFile(path.join(dist, 'index.html')); });
} else {
  const { createServer } = await import('vite'); // dynamic: vite is a devDependency
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}

// Last: any unhandled error, including malformed or oversized JSON bodies, becomes a JSON reply
app.use((err: { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
  const status = err.status ?? 500;
  if (status >= 500) console.error(err);
  if (res.headersSent) { res.end(); return; }
  res.status(status).json({ error: status < 500 ? 'Bad request.' : 'Internal server error.' });
});

app.listen(config.port, config.host, () => console.log(`FlowState on http://${config.host}:${config.port}`));
```
Notes:
- Vite is imported dynamically so a production install (`npm ci --omit=dev`) doesn't need it.
- `/{*splat}` is Express 5's catch-all syntax. Express 4's `*` throws on startup in v5.
- The `/api` 404 handler stops unknown API paths from falling through to `index.html` in production.
- The 4 KB body limit is generous: the largest valid request is ~300 bytes.
- The error handler matters because Express's default error page is HTML (with a stack trace outside production). The client expects `{"error": …}`, so a malformed request would otherwise surface as a vague "Server error (400)".
- `/api/health` gives uptime monitors and the deploy smoke test something cheap to hit that doesn't spend Gemini quota.
- `HOST` defaults to all interfaces (LAN access). Set it to `127.0.0.1` when a reverse proxy on the same box is the only way in.
- In dev, Vite's hot-reload connection uses its own port (24678) unless it's handed the HTTP server. That's fine for local development. Only revisit it if you develop against the server from another machine.

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
Wrap the read loop in `try { … } finally { reader.cancel().catch(() => {}) }`. When the generator throws (an `{"error"}` line) or the caller stops iterating, the response body is then closed instead of left dangling.

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
Delete the `define` block and the `loadEnv` call. The client no longer needs any environment value. (The AI Studio `hmr` block was already removed in Phase 2.)

### `package.json`
```jsonc
"engines": { "node": ">=22.18" },
"scripts": {
  "dev": "node --watch-path=server --watch-path=shared --env-file-if-exists=.env.local server/index.ts",
  "build": "vite build",
  "start": "NODE_ENV=production node --env-file-if-exists=.env.local server/index.ts",
  "lint": "tsc --noEmit"
}
```
Packages:
```bash
npm install express@^5 express-rate-limit@^8     # upgrades the kept template Express 4 → 5, adds the limiter
npm install -D @types/express@^5
```
Express 5 instead of the template's 4: v5 is the current release line, and it forwards errors from async route handlers to the error middleware, which the streaming route relies on. The original 4.x version stays recoverable from the `ai-studio-original` tag. `@google/genai` stays in dependencies, but it's now only used by the server.

`--watch-path` restarts the server when files in `server/` or `shared/` change. Client changes are still hot-reloaded by Vite without a restart.

**Why not plain `--watch`:** it follows every file the process imports, including the temporary config file Vite writes and deletes on each start. Found in Phase 3 testing: the server restarted in an endless loop.

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
HOST=0.0.0.0              # 127.0.0.1 when only a local reverse proxy should reach it
TRUST_PROXY=0             # 1 when behind one reverse proxy (Caddy, nginx, Cloudflare Tunnel)
RATE_LIMIT_PER_MINUTE=10  # per client IP, on /api/verse only
```

---

## Verification

Covers the roadmap exit criteria for Phase 3 plus the shared gate. The deploy milestone has its own smoke test under **Self-hosting**.

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
   # 400 JSON (not an HTML page): malformed body
   curl -s -X POST localhost:3000/api/verse -H 'Content-Type: application/json' -d '{oops'
   # 200: curl -s localhost:3000/api/health
   ```
   Ctrl-C a `curl -N` mid-stream → the server logs `client disconnected, generation cancelled` once, and no error.
   Start with `GEMINI_API_KEY` unset → the server exits immediately with the "not set" message. Start with `PORT=abc` → it exits naming `PORT`.
5. **Bad key:** set `GEMINI_API_KEY=nope` → the UI shows "Server API key is invalid…", not "ENGINE STALLED".
6. **UI:** Stop mid-verse keeps the partial text. Enter during a generation does nothing. A new generation clears an old error.
7. **Production mode:** `npm run build && npm start` → `localhost:3000` serves the app, and refreshing works.

---

## Self-hosting

Decision (2026-10-06): **self-hosted**. Any Linux box works: a VM, an LXC container, a Pi or bare metal. The steps assume Debian/Ubuntu and systemd.

> **The actual first host is Windows (LAN only).** See [Windows host](#windows-host) below. This Linux guide stays for a future move.

### Prerequisites on the box
- **Node 22.18 or newer.** Distro packages are often older. Use NodeSource's apt repo or the official binaries, and check with `node -v`.
- **Build tools, possibly:** `better-sqlite3` (kept from the template) downloads a prebuilt binary when one matches the CPU and Node version, and otherwise compiles. Install `build-essential python3` so a fallback compile doesn't fail the deploy.
- **A dedicated user:** `useradd --system --home /opt/flowstate --shell /usr/sbin/nologin flowstate`.
- **Where `node` lives:** the unit file below assumes `/usr/bin/node` (true for NodeSource and distro packages). With nvm or a manual install, use the path from `command -v node`, and make sure it isn't inside a home directory: `ProtectHome=true` hides those.

### Layout
```
/opt/flowstate/           git checkout, owned by flowstate
/opt/flowstate/.env.local GEMINI_API_KEY etc. — chmod 600, owned by flowstate
```

### Deploy / update
```bash
cd /opt/flowstate
git pull
npm ci                 # full install: the build needs Vite and Tailwind
npm run build          # writes dist/
npm prune --omit=dev   # drop build tools from the running install
sudo systemctl restart flowstate
git tag "deploy-$(date +%Y%m%d-%H%M)"   # records which commit went live, and when
```
**Known limitation:** `npm ci` replaces `node_modules` while the old process is still running. An in-flight verse can fail during that minute. That's acceptable for a personal app. If it ever matters, build in a second checkout and swap directories before restarting.

**Rolling back a deploy:** `git checkout <previous deploy-… tag>`, then rerun the steps from `npm ci` on. That leaves the checkout on a detached commit, so run `git checkout main` before the next normal `git pull`.

### systemd unit: `/etc/systemd/system/flowstate.service`
```ini
[Unit]
Description=FlowState
After=network-online.target
Wants=network-online.target

[Service]
User=flowstate
WorkingDirectory=/opt/flowstate
Environment=NODE_ENV=production
EnvironmentFile=/opt/flowstate/.env.local
ExecStart=/usr/bin/node server/index.ts --production
Restart=on-failure

# Hardening: the app writes nothing to disk
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```
- `ExecStart` calls `node` directly, not `npm start`. npm in between can get in the way of systemd's stop signals, and the env vars already come from `EnvironmentFile`.
- If a database is added later with `better-sqlite3`, add `ReadWritePaths=/opt/flowstate/data`, because `ProtectSystem=strict` makes everything else read-only.
- Logs: `journalctl -u flowstate -f`.

### Exposure: options

**[A] LAN only.** `HOST=0.0.0.0`, `TRUST_PROXY=0`, open port 3000 on the host firewall to the LAN only. Simplest. No HTTPS, which is acceptable on a home network.

**[B] Reverse proxy with HTTPS (needed for access from outside).** Caddy on the same box handles certificates automatically:
```
flowstate.example.com {
    reverse_proxy 127.0.0.1:3000 {
        flush_interval -1
    }
}
```
Set `HOST=127.0.0.1` and `TRUST_PROXY=1`. Keep `flush_interval -1`: without it Caddy can buffer the NDJSON stream, and verses arrive in one lump at the end instead of streaming.

**[C] Tunnel (Tailscale or Cloudflare Tunnel).** Remote access without opening router ports. With Tailscale, behave as [A] on the tailnet. With Cloudflare Tunnel, `TRUST_PROXY=1`.

### If it's reachable from the internet
Every verse costs Gemini quota on your key, and the rate limit only slows abuse down. Put an auth gate in front: Caddy `basic_auth`, Cloudflare Access, or Tailscale-only access. Option [A] or a Tailscale-only [C] avoids the question entirely.

### Smoke test after deploy
1. `systemctl status flowstate` → active.
2. `curl -s localhost:3000/api/health` → `{"ok":true}`, and `curl -s localhost:3000/api/nope` → `{"error":"Not found"}`.
3. `sudo reboot`, then repeat step 1 → the service came back on its own (roadmap exit criterion).
4. Open the app from another device, generate a verse, and watch it stream line by line (not all at once).
5. `grep -c AIza /opt/flowstate/dist/assets/*.js` → `0` (no key in the shipped bundle).

---

## Windows host

Decision (2026-10-07): the first deploy runs on **Windows, LAN only** (AMD Ryzen 7 5800X, x64). The Linux guide above still applies if the app ever moves. Everything below uses PowerShell.

### What's different from Linux
- **No systemd.** A service wrapper starts FlowState at boot and restarts it if it crashes (options below).
- **`npm start` passes `--production`** instead of `NODE_ENV=production`, because that prefix syntax only works in Unix shells. `server/config.ts` accepts either.
- **Windows Firewall** has to allow port 3000, and only on the **Private** (home) network profile.
- **Sleep:** a desktop that goes to sleep takes FlowState offline with it.

### Prerequisites
- **Node 22.18 or newer.** Check with `node -v`. If it's older, install the current LTS from nodejs.org.
- **Git**, to clone and update.
- **`better-sqlite3` (kept template package):** npm normally downloads a prebuilt Windows x64 binary. If `npm ci` instead tries to compile it and fails, install the Visual Studio Build Tools with the "Desktop development with C++" workload, then rerun.

### Layout
```
C:\apps\FlowState\              git checkout (not under OneDrive or your user profile)
C:\apps\FlowState\.env.local    the key and settings (gitignored)
C:\apps\FlowState\logs\         service output
```
`.env.local` for LAN-only:
```
GEMINI_API_KEY="your-key"
HOST=0.0.0.0
TRUST_PROXY=0
```

### First install and every update
```powershell
# first time only
git clone https://github.com/RJBrown88/FlowState C:\apps\FlowState
New-Item -ItemType Directory C:\apps\FlowState\logs

# every deploy
cd C:\apps\FlowState
git pull
npm ci                 # full install: the build needs Vite and Tailwind
npm run build          # writes dist\
npm prune --omit=dev   # drop build tools from the running install
Restart-Service FlowState                          # skip on the very first deploy (no service yet)
git tag "deploy-$(Get-Date -Format yyyyMMdd-HHmm)"   # records which commit went live
```
Stop the service before `npm ci` if it complains about locked files (`Stop-Service FlowState`). Windows locks files that are in use, which Linux doesn't.

### Run it as a service: options

**[A] NSSM (recommended).** A small free tool that wraps any program as a real Windows service. It starts at boot before anyone logs in, restarts on crash, and writes logs to files. Download it from nssm.cc, then in an **admin** PowerShell:
```powershell
$node = (Get-Command node).Source          # usually C:\Program Files\nodejs\node.exe
nssm install FlowState $node "--env-file-if-exists=.env.local server/index.ts --production"
nssm set FlowState AppDirectory C:\apps\FlowState
nssm set FlowState AppStdout C:\apps\FlowState\logs\out.log
nssm set FlowState AppStderr C:\apps\FlowState\logs\err.log
nssm set FlowState AppRotateFiles 1
nssm set FlowState AppRotateBytes 1048576
nssm set FlowState AppRestartDelay 5000
nssm set FlowState Start SERVICE_AUTO_START
nssm start FlowState
```
- If `node` lives under your user profile (nvm-windows and similar), point `$node` at a system-wide install instead. A service can't rely on per-user paths.
- **Optional hardening:** by default the service runs as LocalSystem, which can do anything on the machine. To run it with minimal rights instead, use `nssm set FlowState ObjectName "NT AUTHORITY\LocalService"` and give that account write access to the log folder: `icacls C:\apps\FlowState\logs /grant "NT AUTHORITY\LocalService:(OI)(CI)M"`. If the service then fails with "access denied", check that LocalService can read `C:\apps\FlowState`.

**[B] Task Scheduler (nothing to install).** Create a task:
- Trigger "At startup", and select "Run whether user is logged on or not".
- Action: start `cmd.exe` with arguments `/c node --env-file-if-exists=.env.local server/index.ts --production >> logs\out.log 2>&1`, starting in `C:\apps\FlowState`.
- Settings: "If the task fails, restart every 1 minute", and untick "Stop the task if it runs longer than 3 days".

This works, but restarts and logging are rougher than with NSSM. Updates use `Stop-ScheduledTask` / `Start-ScheduledTask` instead of `Restart-Service`.

### Firewall (LAN only)
```powershell
Get-NetConnectionProfile          # your home network must say NetworkCategory : Private
# if it says Public: Set-NetConnectionProfile -InterfaceAlias "<name from above>" -NetworkCategory Private
New-NetFirewallRule -DisplayName "FlowState (LAN)" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Private
```
If Windows shows a firewall prompt the first time Node listens, allow **Private networks only**.

### Reaching it from other devices
- Find the PC's address with `ipconfig` (IPv4 Address), then open `http://<that-address>:3000` from a phone on the same Wi-Fi.
- Reserve that address in your router's DHCP settings so it doesn't change. `http://<PC-NAME>:3000` often works too.
- **Sleep:** set the PC never to sleep on AC power, or FlowState disappears whenever the PC naps: `powercfg /change standby-timeout-ac 0`.

### Smoke test after deploy
```powershell
Get-Service FlowState                                     # Status: Running
Invoke-RestMethod http://localhost:3000/api/health        # ok : True
Select-String -Path C:\apps\FlowState\dist\assets\*.js -Pattern AIza   # no output = no key in the bundle
```
Then:
1. Restart the PC and run the first two lines again. The service should come back on its own (roadmap exit criterion).
2. On a phone on the Wi-Fi, open `http://<PC-address>:3000` and generate a verse. It should stream in line by line.

**If something fails:** `logs\err.log` usually names the cause: missing `GEMINI_API_KEY`, a port already in use, or a Node path the service can't reach. Paste it to Claude.

### Rolling back
```powershell
cd C:\apps\FlowState
git checkout deploy-<previous timestamp>
npm ci; npm run build; npm prune --omit=dev; Restart-Service FlowState
git checkout main      # before the next normal git pull
```

---

## Rollback
- **Code:** revert the phase. That restores the in-browser Gemini call, and with it the key-in-bundle problem, so a reverted build must not be deployed (roadmap hard rule).
- **Deploy:** check out the previous `deploy-…` tag and redeploy (see *Deploy / update*).
