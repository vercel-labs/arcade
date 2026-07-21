# Arcade

**3D games rendered as ASCII in your terminal, played by humans _and_ frontier AI models.**

Arcade is the first build-out of **Vercel Arcade**: play classic games against frontier models through the [Vercel AI Gateway](https://vercel.com/ai-gateway), or sit back and watch two models play each other. It all runs inside a terminal, drawn with truecolor half-blocks. Everything here is pure TypeScript with **zero native dependencies**: the 3D renderer, the UI layer, and the game rules are all written from scratch.

**Chess and poker are playable today.** Real 3D pieces (and a felt table with chips for poker) are lit and rasterized in software, then presented as ASCII/half-blocks. Play a model yourself, or watch two models play. Either side's model can be swapped mid-match.

> This README covers the codebase and how to run it. Internal product context lives in the Vercel Arcade Notion.

## Play it

Arcade is published as a **private, Vercel-internal** npm package. With `@vercel` npm access you can run it on demand, or install it once and just type `arcade`:

```bash
npx @vercel/arcade@latest        # run the latest without installing

npm i -g @vercel/arcade          # or install globally (pnpm add -g / yarn global add also work)
arcade                           # …then launch it from anywhere
```

Arcade checks for a newer published version at launch and, if one exists, surfaces the exact upgrade command two ways: a line among the startup output, and a popup over the opening prism (with a copy button). `npx @vercel/arcade@latest` always pulls the newest build; a global install stays put until you run the upgrade command.

On first launch it signs you into Vercel with a browser-based device login (like `vercel login`), then asks which team to bill AI usage to and mints an AI Gateway key for it. Tokens are cached under `~/.config/arcade/`; the key itself is re-derived each launch, never stored. Switch team or sign out from the in-app **Account** menu, or with `--switch-team` / `--logout`.

> Best in a truecolor terminal (Ghostty, iTerm2, Kitty, WezTerm, VS Code). It auto-detects and falls back to 256-color, and macOS Terminal.app works.

### Controls

- **Any 3D scene:** **left-drag** orbits, **scroll** zooms, **arrow keys** pan. `q` / `Esc` quits.
- **Chess:** click a piece to highlight its legal moves, click a dot to slide it there. Start a match from the bar (play as White or Black, or watch AI vs AI).
- **Poker:** hover your hole cards to peek, click to lift them; drag the slider to size a bet. Pause/resume or deal a new match from the bar. _In heads-up human-vs-AI you can pick a realtime voice model for your opponent (in poker setup) and talk table-talk with it out loud._

Telemetry: Arcade sends anonymous usage counts (which models get played, match/hand outcomes). It never sends prompts or game content. Opt out with `ARCADE_TELEMETRY=0`.

## Develop it

```bash
pnpm install
pnpm dev
```

You boot into a splash animation: the Vercel triangle dissolving into a rotating glass prism, a _Dark Side of the Moon_ homage that splits a beam into a rainbow. Press any key for the game menu. `pnpm dev` sets `ARCADE_DEV=1`, so internal-only screens (logos, audio, a UI showcase, a poker sandbox) show up; they're hidden in the published build.

> **Don't run `pnpm dev` to "see" the output.** It's a full-screen, raw-mode, infinite TTY program. Snapshot a frame to an image instead (`pnpm snapshot 140 50`). See [AGENTS.md](./AGENTS.md) and [docs/verifying-output.md](./docs/verifying-output.md).

The prism screen is also a curlable endpoint: `curl ascii-prisms.vercel.app`.

## Architecture

A few standalone libraries plus the app that composes them. Imports flow one way. The libraries never import app code, so they stay reusable.

```
src/
  engine/     3D software renderer (no GPU): math, meshes, rasterizer, materials,
              ASCII/half-block presenters, bloom, supersampling
  tui/        retained-mode TUI: flexbox layout + Box/Text/Button, hover/focus/press,
              hit-testing, paints to a Surface
  platform/   terminal control (alt-screen, raw mode, SGR mouse) + input parsing
  rules/      game harness (Game/State + registry) + the chess and poker rules engines
  prism/      the animated prism screen (self-contained), also the curl-able stream behind api/
  ai/         game AI: a Player interface + LLM-backed ModelPlayer + the match loop
  auth/       Vercel sign-in (OAuth device flow) + AI Gateway key resolution
  voice/      realtime speech-to-speech session + mic/speaker I/O + echo cancellation
  telemetry/  fire-and-forget anonymous usage counts (opt-out)
  arcade/     THE app: orchestrator (main.ts) + per-game / scene / shell presentation
  tools/      snapshots, perft, model audits, dev scripts
```

### `engine/`: the 3D ASCII rendering engine

A from-scratch software rasterizer. Column-major `Mat4` math → perspective camera → near-plane clipping → edge-function rasterization → perspective-correct interpolation → z-buffer. The single style hook is the **`Material`** (a vertex + fragment program pair), so the whole arcade shares one controllable look; current materials include a two-light flat-shaded piece material and a glassy refraction material. Meshes come from a built-in cube/tetrahedron or the **OBJ loader** (`parseObj` + `flatShade`).

The render target is handed to one of three **presenters**:

- **half-block**: two truecolor pixels per cell via `▀`, with optional bloom + supersampling.
- **shape-glyph**: picks the character whose ink _shape_ best matches each cell (after Alex Harri's "ASCII rendering"), with a luminance fallback so shadows stay legible.
- **luminance**: a classic dark→light character ramp.

### `tui/`: a retained-mode UI library

A small retained-mode UI layer that provides the shared building blocks for every game (bars, menus, dialogs, dropdowns, sliders). The app rebuilds a tree of `Box`/`Text`/`Button` nodes each frame; the `Screen` runtime carries hover/focus/pressed state across frames (keyed by node id), runs a flexbox-style layout pass (absolute positioning, margins, per-side padding, `overflow:hidden` clipping), hit-tests the mouse, and paints to an engine `Surface`.

Rendering is **unified**: the 3D scene paints into the same `Surface` as the UI, so each frame is one alpha-composited cell grid that gets diffed and flushed (only changed cells are written). That's what lets a translucent **Modal** scrim dim the live scene behind a popup.

### `rules/`: the game harness + chess & poker

An extensible, **AI-ready** harness modeled on DeepMind OpenSpiel (a `Game`/`State` split) and Kaggle Game Arena (a player is just `observation → action`). A `State` exposes `legalActions`, `applyAction`, `isTerminal`, `returns`, `clone`, and notation conversion; games self-register in a name→factory registry, so a `ModelPlayer` and a `HumanPlayer` are interchangeable.

The **chess rules engine** is written from scratch (0x88 board, full legal move generation, castling/en passant/promotion, checkmate/stalemate, the 50-move/threefold/insufficient-material draws, SAN + UCI notation), proven by **perft** against reference node counts (`pnpm exec tsx src/tools/perft.ts`). The **poker engine** is no-limit Texas Hold'em (betting rounds, side pots, a standalone hand evaluator).

## Roadmap

- [x] 3D ASCII rendering engine
- [x] Mini TUI library for in-terminal controls
- [x] Chess: 3D board, interactive play, and a verified rules engine
- [x] **AI Gateway + AI SDK integration**: play **you vs AI** and **AI vs AI**, with mid-match model swaps
- [x] **Poker**: no-limit Texas Hold'em, human-vs-AI and AI-vs-AI
- [x] **Realtime audio "table talk"**: give a heads-up poker opponent a realtime voice model
- [ ] **Model leaderboard**: per-model play-style stats from game telemetry
- [ ] **More games** (Catan in R&D) plus a web build for the public beta

## Scripts

| Command                                | What it does                                  |
| -------------------------------------- | --------------------------------------------- |
| `pnpm dev`                             | Run the arcade (dev mode)                     |
| `pnpm snapshot [cols] [rows] [t]`      | Render a frame to a `.ppm` image (for review) |
| `pnpm snapshot:png …`                  | Render a frame and convert it to `.png`       |
| `pnpm watch`                           | Run with auto-reload                          |
| `pnpm type-check`                      | Type-check with `tsc`                         |
| `pnpm test`                            | Run the unit suite (`src/**/*.test.ts`)       |
| `pnpm models:audit` / `models:report` | Audit / render model compatibility            |
| `pnpm exec tsx src/tools/perft.ts`     | Verify the chess move generator               |

Credits for the techniques and assets this builds on are in [`NOTICE.md`](./NOTICE.md).
