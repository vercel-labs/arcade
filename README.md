# arcade

Terminal-rendered ASCII arcade — 3D games drawn with characters in the terminal, with full mouse + keyboard interaction. Pure TypeScript, zero native dependencies.

## Run

```bash
pnpm install
pnpm dev
```

You boot into an animated attract screen — a Dark Side of the Moon homage: a rotating 3D glass prism splitting a white beam into a rainbow, under a 3D "VERCEL ARCADE" wordmark. **Press any key** to start.

Then you're flying forward through space. Spinning cubes rush toward you from the distance — **move the mouse** (or arrow keys) to dodge them. You score for every cube you thread past; a collision ends the run. Speed ramps up the longer you survive. `R` restarts after a crash, `q` (or `Esc`) quits.

> Best in a truecolor terminal (iTerm2, Ghostty, Kitty, WezTerm, VS Code). Apple Terminal.app has weak mouse support — aiming may not work there.

## How it works

No GPU, no WebGL. Everything is a pure-software pipeline. Two rendering primitives:

- **`src/framebuffer.ts`** — the game's character grid + depth buffer (ASCII glyphs). Serializes to a single string per frame (one `stdout.write`) and only emits a color escape when the color changes between cells.
- **`src/pixel-canvas.ts`** — the attract screen's image-like primitive: an upper-half-block (`▀`) canvas where each cell is two truecolor pixels (foreground = top, background = bottom), composited additively for glow.

On top of those:

- **`src/renderer.ts`** — a minimal triangle rasterizer for the game. Transforms each cube instance's vertices, projects them with perspective (and a 2:1 character-cell aspect correction), back-face culls, then scanline-fills each triangle into a shared character + depth buffer. Flat-shaded by `normal · light`, mapped to an ASCII ramp and 24-bit color.
- **`src/loading.ts`** — the Dark Side of the Moon attract screen: a rotating 3D glass prism (bright chromatic-fringed edges + specular glint), a glowing white beam, a hue-swept rainbow wedge, and the `figlet` "VERCEL ARCADE" wordmark recolored with a gradient.
- **`src/game.ts`** — game state: the player, obstacle spawning, movement, proximity tinting, collision/scoring, and restart.
- **`src/terminal.ts`** — alternate screen, hidden cursor, raw mode, SGR mouse reporting (modes 1003 + 1006), and bulletproof cleanup on every exit path.
- **`src/input.ts`** — parses the raw stdin stream into keyboard and mouse (move / drag / wheel) events.
- **`src/main.ts`** — the game loop: input → update → render at 30fps, plus the HUD and game-over overlay.

## Next steps

- Frame diffing (write only changed cells) for larger grids
- More meshes beyond the cube (load arbitrary `.obj` / glTF)
- More game modes
- Vercel AI Gateway integration for AI-driven game logic

## Scripts

| Command           | What it does              |
| ----------------- | ------------------------- |
| `pnpm dev`        | Run the demo              |
| `pnpm watch`      | Run with auto-reload      |
| `pnpm type-check` | Type-check with `tsc`     |
