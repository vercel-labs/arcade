# Verifying / viewing visual output

This project renders to the terminal. `pnpm dev` is a **full-screen,
raw-mode, animated TTY app**: it switches to the alternate screen, hides the cursor,
takes over stdin, and loops forever. That has two consequences for an agent trying to
"see" the output:

1. Capturing the process's stdout gives you a stream of **ANSI escape codes**, not an
   image — useless for judging how it looks.
2. The process **never exits on its own**, so a normal `Bash` capture just hangs.

So **do not** try to run `pnpm dev` and read its output. Instead, render a frame to an
image and look at that.

## The snapshot workflow (how to actually see a frame)

The engine renders into an RGBA pixel buffer before it becomes half-blocks, so we can
render one frame headlessly and write it to an image. `src/tools/snapshot.ts` runs the
**exact same pipeline as `pnpm dev`** (supersample → downsample → bloom), so the PNG
faithfully represents what the terminal shows.

```bash
# 1. Render a frame of the prism scene to a PPM.
#    args: [cols] [rows] [t]  — t is the animation time in seconds.
pnpm snapshot 140 50 0.7

# 2. Convert PPM -> PNG (macOS built-in `sips`; -Z upscales for legibility).
sips -s format png .snapshots/prism.ppm --out .snapshots/prism.png -Z 1000

# 3. View it — use the Read tool on the absolute path:
#    /Users/<you>/Repos/arcade/.snapshots/prism.png
```

**Shortcut:** `pnpm snapshot:png` does steps 1 and 2 in one go — it passes every arg
straight through to `pnpm snapshot`, then converts whatever `.ppm` it wrote to a sibling
`.png` and prints the path:

```bash
pnpm snapshot:png 140 50 0.7      # → .snapshots/prism.png, ready to Read
```

The Read tool renders PNGs visually, so afterward you can see colors, glow, the
prism, the rainbow — and critique it against the reference images in
`docs/INSPO.MD` / the Pictures folder, instead of guessing from code.

`.snapshots/` is gitignored.

## More than the prism: scenes, UI, and overlays

`pnpm snapshot` (the default, no subcommand) renders the prism. Subcommands render the
other scenes and specific UI states — the chess board, the AI-match HUD, the setup modal,
the game-over card, the Cover Flow menu, and more. Run `pnpm snapshot help` for the full,
authoritative list (it's generated from the tool itself, so it never goes stale). A few:

```bash
pnpm snapshot:png chess-game 140 50 0.6 match   # a live board mid-opening
pnpm snapshot:png chess-overlay 140 50 eval     # match HUD + moves panel + eval bar
pnpm snapshot:png setup 120 40                  # the AI match-setup modal
pnpm snapshot:png gameover 140 50               # the result popup
pnpm snapshot:png coverflow 140 44 1            # Cover Flow carousel at position 1
pnpm snapshot:png ui 110 44 hover=reset         # the button bar, one pill hovered
```

### Inspecting an animation

Render several `t` values to compare motion (e.g. that refraction tracks rotation):

```bash
for t in 0.2 1.0 2.0 3.0; do
  pnpm snapshot 140 50 $t .snapshots/f-$t.ppm
  sips -s format png .snapshots/f-$t.ppm --out .snapshots/f-$t.png -Z 1000
done
```

Then Read each PNG.

## Permissions

`.claude/settings.json` allowlists `pnpm snapshot` (which also covers `pnpm snapshot:png`),
`pnpm exec tsx src/tools/snapshot.ts`, and `sips`, so these run without a prompt.

## What the live terminal experience is

`pnpm dev` boots the **prism screen** (a Dark Side of the Moon homage: a rotating glass
prism splitting a white beam into a rainbow on black); from the button bar you jump to the
**chess** screens or the **logos** showcase. It's drawn with the
upper half-block `▀` at 24-bit color, so it needs a **truecolor terminal** (iTerm2,
Ghostty, Kitty, WezTerm, VS Code). The snapshot PNG and the terminal look essentially
identical — each PNG pixel is one half-block.

When you need to confirm something only the *human* can see (exact terminal colors, input
feel, mouse), ask the user to run `pnpm dev`. For everything visual about a given frame,
snapshot it yourself.
