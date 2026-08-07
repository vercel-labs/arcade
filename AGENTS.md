# Arcade — agent guide

A terminal-rendered ASCII arcade: 3D games and an animated prism screen drawn with
truecolor half-blocks in the terminal. **Pure TypeScript, no GPU, no native deps.** Run
with `tsx`/Node and plain `pnpm`.

## Seeing your own output (read this before judging visuals)

The apps are full-screen, raw-mode, **infinite** TTY programs — do NOT run `pnpm dev` to
"see" them (you'll get escape codes and a hang). Instead, render a frame to a PNG and
view it. **See [docs/verifying-output.md](docs/verifying-output.md).** Quick version:

```bash
pnpm snapshot 140 50 0.7
sips -s format png .snapshots/prism.ppm --out .snapshots/prism.png -Z 1000
# then Read .snapshots/prism.png
```

(`.claude/settings.json` already allowlists these commands.)

## Structure

```
src/
  engine/     reusable software 3D renderer — knows nothing about the arcade (a library)
  tui/        reusable retained-mode UI library — flexbox layout, Surface compositing
  platform/   terminal control (alt screen, raw mode, SGR mouse) + input parsing
  rules/      game harness (Game/State + registry) + the chess rules engine
  prism/      the prism screen — a self-contained visual (scene + splash + curl/HTTP
              stream handler); depends only on engine/, shared by arcade + api/ + tools/
  ai/         game AI: Player interface + LLM-backed ModelPlayer + match loop
  auth/       Vercel sign-in (OAuth device flow) + AI Gateway key resolution
  voice/      realtime speech-to-speech session + mic/speaker I/O + echo cancel
  telemetry/  anonymous usage + canonical game records → Arcade telemetry proxy → Tinybird (opt-out)
  arcade/     THE app: orchestrator (main.ts) + per-game/scene/shell presentation
    games/<game>/   per-game presentation (chess: scene, hud, turntable)
    match/          AI-vs-AI plumbing (driver, setup modal, model catalog)
    scenes/         ambient / idle-loop visuals (prism aside): logos, audio, wisp
    shell/          launcher + window chrome (cover flow, menu, bars, keybindings)
  tools/      snapshot.ts (render a frame to an image) + dev scripts
```

Import direction is one-way: `arcade/` consumes the libraries (`engine/` via the
`engine/index.ts` barrel, `tui/` via `tui/index.ts`, `auth/`, `voice/`, and `prism/` via
their `index.ts` barrels, plus `platform/`, `rules/`, and `ai/` à la carte).
**The libraries never import app code** — keep it that way so they stay reusable (the goal
is to grow `engine/` into a 3D game engine and `tui/` into the shared UI toolkit for every
game). Inside a library, modules import each other directly, not through the barrel.
`prism/` is library-tier for the same reason: it's the deploy unit behind `api/` (the
`curl`-able stream), so it must not depend on the arcade.

## Commands

- `pnpm dev` — run the arcade (prism screen → chess / logos)
- `pnpm snapshot [cols] [rows] [t]` — render a frame to `.snapshots/prism.ppm` (`pnpm snapshot help` lists all subcommands)
- `pnpm snapshot:png …` — same, then convert the `.ppm` to a `.png` in one step
- `pnpm type-check` — `tsc --noEmit`
- `pnpm test` — unit tests via `node:test` under `tsx` (auto-discovers `src/**/*.test.ts`; no extra deps)
- `pnpm catan:check capture` then `pnpm catan:check` — fingerprint 24 Catan views before a refactor
  and compare after, to prove a move of mesh or scene code doesn't change what's drawn. A pass means
  the `.ppm` snapshots are byte-identical too. The baseline is local (gitignored), not a committed
  golden file, so intended visual changes don't fight it — just re-`capture`.

## Issue tracking (Linear)

Work is tracked in Linear — team **AI Gateway**, project **Arcade**; issues are `AIG-###`
(e.g. `AIG-77`), poker work under the **Poker Demo Day** milestone. Via the Linear MCP,
**skip `list_teams`** (it returns the whole org) — go straight to the project: `list_issues`
with `project: "Arcade"` (add `assignee: "me"`), or `get_issue AIG-###`. Branches follow
`brianzhang/aig-###-<slug>` (Linear's suggested name). When you finish a piece of work, comment
on the issue citing the commit (`https://github.com/vercel-labs/arcade/commit/<sha>`), and move
it to Done only when fully delivered.

## AI Gateway key (Vercel sign-in)

Everything AI reads `process.env.AI_GATEWAY_API_KEY`. Arcade resolves it once at
startup through a `vercel login`-style OAuth **device flow** (plain text, before
the alt-screen), then a **team picker**, then a key minted for that team via
`exchange: true` (get-or-create, billed to the team). An inherited shell or
`.env.local` key is deliberately ignored by Arcade so an unrelated credential
cannot silently select the wrong billing scope. Model testing tools reuse the
same cached login and selected team via `ensureCachedGatewayKey()`; they also
ignore inherited keys and require no pasted credential.

Tokens persist at `~/.config/arcade/auth.json` (0600); the minted key is **not**
stored — it's re-derived each launch. Reuses the Vercel CLI's public OAuth client
(`CLIENT_ID` in [src/auth/vercel-auth.ts](src/auth/vercel-auth.ts)), the one allow-listed
to mint gateway keys. In-app: switch team + sign out live in the home menu / account
modal (no key bindings); flags `--login` / `--switch-team` / `--logout`. Auth lives in `src/auth/{env,vercel-auth,
vercel-api,gateway-key}.ts`; `src/platform/open-browser.ts` opens the browser.

## Telemetry

`src/telemetry/` sends anonymous usage events plus canonical chess match and poker
match/hand records (moves, actions, outcomes, and cards with their visibility). It never
sends prompts, reasoning, chat, voice, or account identity. Human-played records carry a
pseudonymous `playerKey` (a hash of the anonymous install id) so a player's own games can
be attributed for personal stats — the human's equivalent of a model's slug, never a
Vercel account id. Everything goes to the Arcade telemetry proxy (`apps/telemetry-proxy`,
a standalone hosted Vercel service that holds the only credential — a resource-scoped
append token — and forwards into Tinybird), so the published client ships no token or key.
Delivery is non-blocking and non-throwing: lightweight events are fire-and-forget;
canonical records use a durable acknowledged outbox (deleted only on a 200). Opt out three
ways: `ARCADE_TELEMETRY=0`, the `arcade telemetry disable` subcommand, or the home-menu
toggle — the latter two persist to `~/.config/arcade/telemetry.json`. The Tinybird datasource schemas
live in the gateway repo (`ai-gateway/tinybird-src/datasources/arcade_*_v1.datasource`),
deployed to the Vercel_AI workspace via `tb push`. Proxy deploy + provisioning notes are in
[apps/telemetry-proxy/README.md](apps/telemetry-proxy/README.md). This is the data layer
the leaderboard milestone builds on.

## Deploying the curl prism

The `curl ascii-prisms.vercel.app` endpoint (the `ascii-prisms` project in the Vercel
Labs team) **auto-deploys on push to `main`**. The handler is
[api/index.ts](api/index.ts) → [src/prism/prism-stream.ts](src/prism/prism-stream.ts) —
a self-contained function depending only on `src/prism` + `src/engine`, never the
arcade. `vercel.json` builds it via [scripts/build-vercel-output.mjs](scripts/build-vercel-output.mjs)
(esbuild bundles the graph into one `.mjs`, install skipped), and its `ignoreCommand`
skips the rebuild unless the prism's closure changed (`api`, `src/prism`, `src/engine`,
the build script, `vercel.json`) — so arcade-only commits don't redeploy the prism.
Test the exact handler locally: `pnpm exec tsx src/tools/serve-prism.ts` then
`curl -sN localhost:8080`.

## Conventions

- Pin dependency versions (no `^`/`~`); prefer zero/few deps.
- No dead code — if a refactor orphans a file/export, delete it.
- The renderer's style hook is the **`Material`** (vertex + fragment shader). New visual
  looks should be materials, so the whole arcade shares one controllable style.
- Terminal emoji: only use glyphs whose Unicode `Emoji_Presentation` is `Yes`, or the renderer
  desyncs from the terminal in a way the diff cannot repair. Check with
  `pnpm exec tsx src/tools/glyph-width.ts` — see [docs/emoji.md](docs/emoji.md).
- `reference/` holds read-only inspo clones (gitignored). `docs/INSPO.MD` lists sources.
  Rendering patterns are informed by `sinclairzx81/zero` (MIT) — see `NOTICE.md`.
