# Arcade

**3D games rendered as ASCII in your terminal, built to be played by humans _and_ AI models.**

Arcade is the first build-out of **Vercel Arcade**: a showcase where you can play classic games against frontier AI models (or watch the models play each other) entirely inside a terminal, rendered with truecolor characters. Everything here is pure TypeScript with **zero native dependencies**. The 3D renderer, the UI layer, and the game rules are all written from scratch.

**Chess is the game currently in development.** The pieces are real 3D models, lit and rasterized in software, and presented as ASCII/half-blocks. You can already click a piece, see its legal moves, and play it out; the full rules engine is in place. (An earlier 3D dodge prototype has been removed — chess is the focus.)

> Internal design + product context lives in the Vercel Arcade Notion. This README covers the codebase.

## Run

```bash
pnpm install
pnpm dev
```

You boot into an animated attract screen (a _Dark Side of the Moon_ homage: a rotating glass prism splitting a beam into a rainbow). From the bottom button bar you can jump to:

- **Chess Game**: the playable 3D board (see below).
- **Chess**: a turntable showcase of the piece models.
- **Demo**: a lit, spinning engine cube.
- **Logos**: a showcase of the AI Gateway provider logos as 3D textured quads.
- **mode**: cycle the render style between **ascii** (shape-matched glyphs) · **color** (half-block truecolor) · **luminance** (brightness ramp).

**Chess Game controls:** click a piece to highlight its square + show legal-move dots, click a dot to slide it there. **Left-drag** orbits, **scroll** zooms, **arrow keys** pan, **Reset View** recenters. `q`/`Esc` quits.

> Best in a truecolor terminal (Ghostty, iTerm2, Kitty, WezTerm, VS Code). Apple Terminal.app has weak mouse support.

## Architecture

The repo is organized as a few standalone libraries plus the app that composes them. Imports flow one way: the libraries never import app code, so they stay reusable.

```
src/
  engine/     3D software renderer (no GPU): math, meshes, rasterizer, materials,
              ASCII/half-block presenters, bloom, supersampling
  tui/        mini retained-mode TUI library: flexbox layout + Box/Text/Button,
              hover/focus/press state, hit-testing, paints to a Surface
  platform/   terminal control (alt-screen, raw mode, SGR mouse) + input parsing
  games/      game harness (Game/State + registry) and the chess rules engine
  arcade/     THE app: orchestrator, attract scene, chess screens, logos showcase
  demo/       engine cube demo
  tools/      snapshots, perft, mesh slicing/decimation, benchmarks
```

### `engine/`: the 3D ASCII rendering engine

A from-scratch software rasterizer. Column-major `Mat4` math → perspective camera → near-plane clipping → edge-function rasterization → perspective-correct interpolation → z-buffer. The single style hook is the **`Material`** (a vertex + fragment program pair), so the whole arcade shares one controllable look; current materials include a two-light flat-shaded piece material and a glassy refraction material. Meshes come from a built-in cube/tetrahedron or the **OBJ loader** (`parseObj` + `flatShade`).

The render target is then handed to one of three **presenters**:

- **half-block**: two truecolor pixels per cell via `▀`, with optional bloom + supersampling.
- **shape-glyph**: picks the character whose ink _shape_ best matches each cell (after Alex Harri's "ASCII rendering"), with a luminance fallback so shadows stay legible.
- **luminance**: a classic dark→light character ramp.

### `tui/`: a mini TUI library

A small retained-mode UI layer, growing into the shared building blocks for every game (controls, menus, dialogs, pickers). The app rebuilds a tree of `Box`/`Text`/`Button` nodes each frame; the `Screen` runtime carries hover/focus/pressed state across frames (keyed by node id), runs a flexbox-style layout pass (absolute positioning, margins, per-side padding, `overflow:hidden` clipping), hit-tests the mouse, and paints to an engine `Surface`.

Rendering is **unified**: the 3D scene paints into the same `Surface` as the UI, so each frame is one alpha-composited cell grid that gets diffed and flushed (only changed cells are written). This is what lets a translucent **Modal** scrim dim the live scene behind a popup — the chess promotion picker is the first consumer. Richer components (`Input`, `Select`, `ScrollBox`, `Slider`) are being added as games need them.

### `games/`: the game harness + chess

An extensible, **AI-ready** harness modeled on DeepMind OpenSpiel (a `Game`/`State` split) and Kaggle Game Arena (a player is just `observation → action`). A `State` exposes `legalActions`, `applyAction`, `isTerminal`, `returns`, `clone`, and notation conversion; games self-register in a name→factory registry.

The **chess rules engine** is implemented from scratch (0x88 board, full legal move generation, castling/en passant/promotion, checkmate/stalemate, and the 50-move/threefold/insufficient-material draws, with SAN + UCI notation). Correctness is proven by **perft** against the known reference node counts (`pnpm exec tsx src/tools/perft.ts`).

## Roadmap

- [x] 3D ASCII rendering engine
- [x] Mini TUI library for in-terminal controls
- [x] Chess: 3D board, interactive play, and a verified rules engine
- [ ] **AI Gateway + AI SDK integration**: wire frontier models in to play **you vs AI** and **AI vs AI**. The game harness exposes the board so an agent can read the position and submit legal moves.
- [ ] **Realtime audio "table talk"**: give the models a voice so they can banter/commentate as they play.
- [ ] **More games**: poker and codenames next, reusing the same engine + harness.

## Scripts

| Command                                       | What it does                                  |
| --------------------------------------------- | --------------------------------------------- |
| `pnpm dev`                                    | Run the arcade                                |
| `pnpm demo`                                   | Run the engine cube demo                      |
| `pnpm snapshot [cols] [rows] [t]`             | Render a frame to a `.ppm` image (for review) |
| `pnpm watch`                                  | Run with auto-reload                          |
| `pnpm type-check`                             | Type-check with `tsc`                         |
| `pnpm exec tsx src/tools/perft.ts`            | Verify the chess move generator               |

Credits for the techniques and assets this builds on are in [`NOTICE.md`](./NOTICE.md).
