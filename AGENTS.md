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
  games/      game harness (Game/State + registry) + the chess rules engine
  arcade/     THE app: orchestrator (main.ts) + chess screens + prism/logos scenes
  demo/       engine cube demo
  tools/      snapshot.ts (render a frame to an image)
```

Import direction is one-way: `arcade/` consumes the libraries (`engine/` via the
`engine/index.ts` barrel, `tui/` via `tui/index.ts`, plus `platform/` and `games/`).
**The libraries never import app code** — keep it that way so they stay reusable (the goal
is to grow `engine/` into a 3D game engine and `tui/` into the shared UI toolkit for every
game). Inside a library, modules import each other directly, not through the barrel.

## Commands

- `pnpm dev` — run the arcade (prism screen → chess / demo / logos)
- `pnpm demo` — run the engine cube demo
- `pnpm snapshot [cols] [rows] [t]` — render a frame to `.snapshots/prism.ppm`
- `pnpm type-check` — `tsc --noEmit`
- `pnpm test` — unit tests via `node:test` under `tsx` (no extra deps)

## AI Gateway key (Vercel sign-in)

Everything AI reads `process.env.AI_GATEWAY_API_KEY`. It's resolved once at
startup by `ensureGatewayKey()` ([src/ai/gateway-key.ts](src/ai/gateway-key.ts)),
with this precedence:

1. An existing `AI_GATEWAY_API_KEY` (env or `.env.local`) wins — skips login.
2. Otherwise a `vercel login`-style OAuth **device flow** (plain text, before the
   alt-screen), then a **team picker**, then a key minted for that team via
   `exchange: true` (get-or-create, billed to the team).

Tokens persist at `~/.config/arcade/auth.json` (0600); the minted key is **not**
stored — it's re-derived each launch. Reuses the Vercel CLI's public OAuth client
(`CLIENT_ID` in [src/ai/vercel-auth.ts](src/ai/vercel-auth.ts)), the one allow-listed
to mint gateway keys. In-app: `s` switch team, `o` (menu) sign out; flags
`--login` / `--switch-team` / `--logout`. Auth lives in `src/ai/{vercel-auth,
vercel-api,gateway-key}.ts`; `src/platform/open-browser.ts` opens the browser.

## Conventions

- Pin dependency versions (no `^`/`~`); prefer zero/few deps.
- No dead code — if a refactor orphans a file/export, delete it.
- The renderer's style hook is the **`Material`** (vertex + fragment shader). New visual
  looks should be materials, so the whole arcade shares one controllable style.
- `reference/` holds read-only inspo clones (gitignored). `docs/INSPO.MD` lists sources.
  Rendering patterns are informed by `sinclairzx81/zero` (MIT) — see `NOTICE.md`.
