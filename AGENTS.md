# Arcade — agent guide

A terminal-rendered ASCII arcade: 3D games and an animated attract screen drawn with
truecolor half-blocks in the terminal. **Pure TypeScript, no GPU, no native deps.** Run
with `tsx`/Node and plain `pnpm`.

## Seeing your own output (read this before judging visuals)

The apps are full-screen, raw-mode, **infinite** TTY programs — do NOT run `pnpm dev` to
"see" them (you'll get escape codes and a hang). Instead, render a frame to a PNG and
view it. **See [docs/verifying-output.md](docs/verifying-output.md).** Quick version:

```bash
pnpm snapshot 140 50 0.7
sips -s format png .snapshots/attract.ppm --out .snapshots/attract.png -Z 1000
# then Read .snapshots/attract.png
```

(`.claude/settings.json` already allowlists these commands.)

## Structure

```
src/
  engine/     reusable software 3D renderer — knows nothing about the arcade (a library)
  platform/   terminal control (alt screen, raw mode, SGR mouse) + input parsing
  arcade/     THE app: orchestrator (main.ts) + dodge game + attract scene
  demo/       engine cube demo
  tools/      snapshot.ts (render a frame to an image)
```

Import direction is one-way: `arcade/` and `demo/` consume `engine/` (via the
`engine/index.ts` barrel) and `platform/`. **The engine never imports app code** — keep
it that way so it stays reusable (the goal is to grow it into a 3D game engine, e.g. a
poker table). Inside `engine/`, modules import each other directly, not the barrel.

## Commands

- `pnpm dev` — run the arcade (attract screen → dodge game)
- `pnpm demo` — run the engine cube demo
- `pnpm snapshot [cols] [rows] [t]` — render a frame to `.snapshots/attract.ppm`
- `pnpm type-check` — `tsc --noEmit`

## Conventions

- Pin dependency versions (no `^`/`~`); prefer zero/few deps.
- No dead code — if a refactor orphans a file/export, delete it.
- The renderer's style hook is the **`Material`** (vertex + fragment shader). New visual
  looks should be materials, so the whole arcade shares one controllable style.
- `reference/` holds read-only inspo clones (gitignored). `docs/INSPO.MD` lists sources.
  Rendering patterns are informed by `sinclairzx81/zero` (MIT) — see `NOTICE.md`.
