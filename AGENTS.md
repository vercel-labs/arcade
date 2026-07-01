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
  arcade/     THE app: orchestrator (main.ts) + per-game/scene/shell presentation
    games/<game>/   per-game presentation (chess: scene, hud, turntable)
    match/          AI-vs-AI plumbing (driver, setup modal, model catalog)
    scenes/         ambient / attract-mode visuals (prism aside): logos, audio, wisp
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

## AI Gateway key (Vercel sign-in)

Everything AI reads `process.env.AI_GATEWAY_API_KEY`. It's resolved once at
startup by `ensureGatewayKey()` ([src/auth/gateway-key.ts](src/auth/gateway-key.ts)),
with this precedence:

1. An existing `AI_GATEWAY_API_KEY` (env or `.env.local`) wins — skips login.
2. Otherwise a `vercel login`-style OAuth **device flow** (plain text, before the
   alt-screen), then a **team picker**, then a key minted for that team via
   `exchange: true` (get-or-create, billed to the team).

Tokens persist at `~/.config/arcade/auth.json` (0600); the minted key is **not**
stored — it's re-derived each launch. Reuses the Vercel CLI's public OAuth client
(`CLIENT_ID` in [src/auth/vercel-auth.ts](src/auth/vercel-auth.ts)), the one allow-listed
to mint gateway keys. In-app: `s` switch team, `o` (menu) sign out; flags
`--login` / `--switch-team` / `--logout`. Auth lives in `src/auth/{env,vercel-auth,
vercel-api,gateway-key}.ts`; `src/platform/open-browser.ts` opens the browser.

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
- `reference/` holds read-only inspo clones (gitignored). `docs/INSPO.MD` lists sources.
  Rendering patterns are informed by `sinclairzx81/zero` (MIT) — see `NOTICE.md`.
