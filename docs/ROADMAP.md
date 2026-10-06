# FlowState Roadmap

Last updated 2026-10-06. Based on the code review of the original AI Studio export.

**Where it starts:** the app installs, typechecks, builds and passes `npm audit`, but it ships the API key to the browser, has three rendering/input bugs, and depends on a preview model that Google will retire.

**Where it ends:** a self-hosted FlowState with the key safely on the server, a clean project identity, and a model that can be changed (or replaced in an emergency) without touching code.

The *what* and *why* live here. The *how* lives in each phase's blueprint. *Who does what, in order* lives in the [action plan](ACTION_PLAN.md).

---

## Decisions

| Date | Question | Decision | Effect on the plan |
|------|----------|----------|--------------------|
| 2026-10-06 | Where will it run? | Self-hosted | Phase 3 becomes mandatory before any deploy. A deploy milestone is added. |
| 2026-10-06 | Remove template packages? | Keep them for now | Phase 2 reorganizes instead of removing. The original import gets a git tag. Final call → backlog. |
| 2026-10-06 | Return to AI Studio? | No | Phase 2 strips the AI Studio wiring. |

---

## Sequence

| Step | Outcome | Size | Needs | Status | Blueprint |
|------|---------|------|-------|--------|-----------|
| **Phase 1** — UI bugs | One generation at a time, correct bar numbers, no dropped text | S | — | Not started | [01](blueprints/01-ui-bugs.md) |
| **Phase 2** — Project hygiene | Correct package sections, FlowState naming, no AI Studio leftovers, original tagged | S | — | Not started | [02](blueprints/02-dependency-hygiene.md) |
| **Phase 3** — Server-side key | Key never reaches the browser. Adds Stop button, real errors, rate limiting. | L | 2 | Not started | [03](blueprints/03-server-side-key.md) |
| **Milestone: first deploy** | FlowState running on the self-hosted box | M | 1, 3 | Not started | [03 § Self-hosting](blueprints/03-server-side-key.md#self-hosting) |
| **Phase 4** — Model config | Model set in one place and swappable by config. Choice backed by an eval. | M | 3, 1 (soft) | Not started | [04](blueprints/04-model-config.md) |

S = an evening, M = a weekend, L = a few sessions. Status values: Not started → In progress → Done.

### Why this order
- **Phases 1 and 2 are independent** and can go in either order. Both are small and give a clean baseline before structural work.
- **2 before 3:** Phase 3 changes packages. Settling `package.json` first keeps the Phase 3 diff about the server alone.
- **3 before 4:** Phase 3 moves the Gemini call to the server, and Phase 4 changes that call. Reversing them means doing the work twice.
- **Deploy before 4:** once the key is safe, nothing blocks hosting. Phase 4 can then be tuned against the live app.
- **4 softly needs 1:** Phase 4's eval script reuses Phase 1's bar parser.

---

## Done when

Every phase also has to meet the shared gate below. Detailed checks are in each blueprint's *Verification* section.

| Step | Exit criteria |
|------|---------------|
| Phase 1 | Holding or repeating Enter mid-generation produces exactly one verse. Bars number 01…N with no gaps. Every `//` segment the model writes is shown. |
| Phase 2 | Production installs exclude build tools. No package version changed. The name is FlowState in package, title and README. No AI Studio references remain. `ai-studio-original` tag is on GitHub. |
| Phase 3 | The built bundle contains no key. The browser only talks to `/api`. Stop keeps a partial verse. Bad key or bad input shows a specific message. Requests are rate-limited. Production mode serves the app. |
| First deploy | Exposure option chosen (see Open questions). The service survives a reboot. A verse streams line by line from another device. The smoke test in Blueprint 3 passes. |
| Phase 4 | The model ID appears in one place only. Changing it is an env var plus restart. A nonexistent model shows a clear error. The default model is picked from recorded eval results. |

**Shared gate (every phase):** `npm run lint` and `npm run build` pass, the app is smoke-tested in the browser, and the blueprint's verification steps are done. From Phase 3 on, also confirm the key is absent from `dist/`.

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Preview model retired before Phase 4 | Medium | App stops generating | Phase 3 turns this into a clear "model unavailable" error. If it happens, do Phase 4's step 4a (config-driven model) immediately; the eval can follow. |
| Model IDs in Blueprint 4 are out of date | Medium | Wrong default | Blueprint 4 has an explicit step to verify them against Google's docs before choosing. |
| Host's Node is older than 22.18 | Medium | Server won't start | Check `node -v` on the box before Phase 3 work is deployed. Install from NodeSource if needed. |
| `better-sqlite3` fails to compile on the host | Low–Med | Deploy fails at install | Install build tools on the box (Blueprint 3). Or revisit the keep-templates decision. |
| Public exposure burns Gemini quota | Low (if gated) | Cost | Rate limit (Phase 3) plus an auth gate or LAN/tailnet-only exposure (deploy milestone). |

---

## Open questions

| Question | Needed by | Options |
|----------|-----------|---------|
| How is the app reached? | First deploy | LAN only / Caddy + HTTPS / Tailscale or Cloudflare Tunnel (trade-offs in Blueprint 3) |
| What's the host? (OS, Node version, CPU arch) | First deploy | Determines the Node install and whether `better-sqlite3` needs compiling |
| Which model is the default? | End of Phase 4 | Decided by the eval |

---

## Review findings → where they're handled

| Finding | Handled in |
|---------|------------|
| Enter starts a second generation | Phase 1 |
| Bar numbers skip | Phase 1 |
| Text after a second `//` dropped | Phase 1 |
| Generic names, AI Studio boilerplate, garbled comment | Phase 2 |
| Build tools installed in production | Phase 2 |
| Uncommitted lockfile | Done (`47d7022`) |
| API key in the client bundle | Phase 3 |
| No cancel, hidden error messages | Phase 3 |
| 661 KB bundle (Gemini SDK in the browser) | Phase 3 |
| Preview model, name in three places, `temperature: 0.9` | Phase 4 |
| Unused template packages | Backlog (kept by decision) |

---

## Backlog (unscheduled)

- **Template packages:** final keep-or-remove decision. Keep `better-sqlite3` if a saved-verses or favourites feature is planned.
- **Major upgrades:** Vite, React plugin, motion, lucide-react, TypeScript. Do one at a time, each with its own build and smoke test.
- **Accessibility:** tooltips are hover-only and invisible to touch and keyboard users.
- **Tests:** unit tests for the bar parser (Phase 1) and request validation (Phase 3).
- **Mobile:** confirm the verse output scrolls on a phone.
- **Footer:** the coordinates, status light and version number are decorative. Keep them or make them real.

---

## Working agreement

- **Branches:** each phase is developed on a branch and lands on `main` as a unit once its exit criteria pass. Commit granularity inside a phase is up to the blueprint.
- **Rollback:** any phase can be reverted as a unit. `ai-studio-original` (created in Phase 2) marks the untouched import.
- **Keeping this current:** update the Status column as phases move. Add a row to Decisions whenever an open question is answered. Change a blueprint, not this file, when the *how* changes.
