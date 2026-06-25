// Headless render of a frame to a PPM image (convert to PNG with `sips`). Lets
// rendered output be viewed as an image instead of a live TTY.
//
//   pnpm exec tsx src/tools/snapshot.ts [cols] [rows] [t] [out.ppm]
//   pnpm exec tsx src/tools/snapshot.ts chess [cols] [rows] [out.ppm]
//   pnpm exec tsx src/tools/snapshot.ts ui [cols] [rows] [hover=<id>|focus=<id>] [out.ppm]
//   pnpm exec tsx src/tools/snapshot.ts overlay [chess|chess-game|attract] [cols] [rows] [out.ppm]
import { writeFileSync } from 'node:fs';
import { bloom, downsample, RenderTarget, shapeGlyphToSurface, Surface } from '../engine/index.ts';
import { FONT } from '../engine/font8x8.ts';
import { AttractScene } from '../arcade/attract.ts';
import { ChessScene } from '../arcade/chess.ts';
import { ChessGameScene } from '../arcade/chess-game.ts';
import { LogosScene } from '../arcade/logos-scene.ts';
import { buildBar, buildPromotion, type Mode } from '../arcade/bars.ts';
import { buildShowcase, mountShowcase } from '../arcade/ui-showcase.ts';
import type { Color } from '../games/chess/types.ts';
import { layout, paint, Screen, type PaintState } from '../tui/index.ts';

type Rgb = [number, number, number];
// One terminal cell rasterizes to CW×CH pixels; the 8x8 glyph stamps top-left.
const CW = 8;
const CH = 8;

// Rasterize a Surface to a PPM at 8×8 px/cell: optionally fill each cell's two
// half-block background colors (the scene behind a transparent overlay), then
// stamp the bitmap-font glyph for opaque cells on top. Shared by the ui and
// overlay snapshots so their pixel output can't drift. `bgAt` returning null (or
// omitted) leaves the cell on the black background.
function surfaceToPpm(
  surf: Surface,
  cols: number,
  rows: number,
  out: string,
  bgAt?: (cx: number, cy: number) => { top: Rgb; bot: Rgb } | null,
): void {
  const W = cols * CW;
  const H = rows * CH;
  const body = Buffer.alloc(W * H * 3); // black background
  const put = (px: number, py: number, c: Rgb): void => {
    const i = (py * W + px) * 3;
    body[i] = Math.max(0, Math.min(255, c[0]));
    body[i + 1] = Math.max(0, Math.min(255, c[1]));
    body[i + 2] = Math.max(0, Math.min(255, c[2]));
  };
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const bg = bgAt?.(cx, cy) ?? null;
      if (bg) {
        // Scene first: top half = upper pixel, bottom half = lower pixel.
        for (let py = 0; py < CH; py++) {
          for (let px = 0; px < CW; px++) put(cx * CW + px, cy * CH + py, py < CH / 2 ? bg.top : bg.bot);
        }
      }
      const cell = surf.getCell(cx, cy);
      if (!cell || !cell.opaque) continue; // transparent → background shows through
      const glyph = FONT[cell.ch];
      for (let py = 0; py < CH; py++) {
        const bits = glyph?.[py] ?? '';
        for (let px = 0; px < CW; px++) {
          const on = glyph ? bits[px] === '1' : blockBits(cell.ch, px, py);
          put(cx * CW + px, cy * CH + py, on ? cell.fg : cell.bg);
        }
      }
    }
  }
  writeFileSync(out, Buffer.concat([Buffer.from(`P6\n${W} ${H}\n255\n`, 'ascii'), body]));
  console.log(`wrote ${out} (${W}x${H})`);
}

// The 8x8 ASCII font has no block/box-drawing glyphs, so for those chars we
// synthesize the pixel pattern procedurally — otherwise half-blocks, lines,
// borders, and the slider/scrollbar render blank in snapshots (they'd be fine in
// a real terminal). Covers the glyphs the TUI components actually emit. px/py are
// 0..7 within the cell; mid = the central 2 rows/cols (3,4).
function blockBits(ch: string, px: number, py: number): boolean {
  const midX = px === 3 || px === 4;
  const midY = py === 3 || py === 4;
  switch (ch) {
    case '█':
      return true;
    case '▀':
      return py < 4;
    case '▄':
      return py >= 4;
    case '▌':
      return px < 4;
    case '▐':
      return px >= 4;
    case '░':
      return (px + py) % 4 === 0;
    case '▒':
      return (px + py) % 2 === 0;
    case '▓':
      return (px + py) % 4 !== 0;
    case '─':
    case '━':
      return midY;
    case '│':
    case '┃':
      return midX;
    case '●':
      return (px - 3.5) ** 2 + (py - 3.5) ** 2 <= 7;
    case '•':
      return (px - 3.5) ** 2 + (py - 3.5) ** 2 <= 3;
    case '╭':
    case '┌':
      return (midY && px >= 3) || (midX && py >= 3);
    case '╮':
    case '┐':
      return (midY && px <= 4) || (midX && py >= 3);
    case '╰':
    case '└':
      return (midY && px >= 3) || (midX && py <= 4);
    case '╯':
    case '┘':
      return (midY && px <= 4) || (midX && py <= 4);
    default:
      return false;
  }
}

const noop = (): void => {};
const barActions = { chessGame: noop, demo: noop, logos: noop, ui: noop, back: noop, reset: noop, mode: noop, quit: noop };

// Render a scene full-height, then composite that screen's button bar over it —
// proving the bar sits ON TOP of the 3D scene (opaque pills overwrite it;
// transparent gaps show it through).
function overlaySnapshot(): void {
  const scene = (process.argv[3] as Mode) ?? 'chess';
  const cols = Number(process.argv[4]) || 110;
  const rows = Number(process.argv[5]) || 40;
  const out = process.argv[6] ?? `.snapshots/overlay-${scene}.ppm`;
  const SS = 3;

  const target = new RenderTarget(cols * SS, rows * 2 * SS);
  if (scene === 'chess') new ChessScene().renderScene(target);
  else if (scene === 'chess-game') new ChessGameScene().renderScene(target);
  else new AttractScene().renderScene(target, 0.6);
  const display = downsample(target, SS);
  if (scene === 'attract') bloom(display, { threshold: 65, intensity: 0.85, radius: 2, passes: 2 });

  const root = buildBar(scene, 'ascii', barActions);
  const surf = new Surface(cols, rows);
  layout(root, { x: 0, y: rows - 2, w: cols, h: 1 });
  paint(root, surf, { hoverId: 'reset', focusId: null, pressedId: null });

  const dc = display.color; // cols × (rows*2), RGB floats
  const at = (x: number, y: number): Rgb => {
    const i = (y * cols + x) * 3;
    return [dc[i], dc[i + 1], dc[i + 2]];
  };
  surfaceToPpm(surf, cols, rows, out, (cx, cy) => ({ top: at(cx, cy * 2), bot: at(cx, cy * 2 + 1) }));
}

// Rasterize the button-bar tree (laid out + painted onto a Surface) to a PPM.
// Verifies layout, centering, wide chars, and hover/focus styling without a TTY.
function uiSnapshot(): void {
  const args = process.argv.slice(3);
  const cols = Number(args[0]) || 110;
  const rows = Number(args[1]) || 44;
  const stateArg = args.find((a) => a.includes('=')) ?? '';
  const out = args.find((a) => a.endsWith('.ppm')) ?? '.snapshots/ui.ppm';

  const state: PaintState = { hoverId: null, focusId: null, pressedId: null };
  const [k, v] = stateArg.split('=');
  if (k === 'hover') state.hoverId = v;
  else if (k === 'focus') state.focusId = v;
  else if (k === 'pressed') state.pressedId = v;

  const root = buildBar('attract', 'ascii', barActions);
  const surf = new Surface(cols, rows);
  layout(root, { x: 0, y: rows - 2, w: cols, h: 1 });
  paint(root, surf, state);

  surfaceToPpm(surf, cols, rows, out);
}

function sceneSnapshot(): void {
  const a0 = process.argv[2];
  const scene = a0 === 'chess' || a0 === 'chess-game' || a0 === 'logos' ? a0 : null;
  const args = scene ? process.argv.slice(3) : process.argv.slice(2);
  const cols = Number(args[0]) || 110;
  const rows = Number(args[1]) || 44;
  const t = Number(args[2]) || 0.6;
  const out = args[3] || `.snapshots/${scene ?? 'attract'}.ppm`;
  const SS = 3;

  const target = new RenderTarget(cols * SS, (rows - 1) * 2 * SS);
  if (scene === 'chess') {
    new ChessScene().renderScene(target);
  } else if (scene === 'chess-game') {
    new ChessGameScene().renderScene(target);
  } else if (scene === 'logos') {
    new LogosScene().renderScene(target, t);
  } else {
    new AttractScene().renderScene(target, t);
  }
  const display = downsample(target, SS);
  // Bloom the emissive screens (prism + logo wisps); skip for solid chess geometry.
  if (!scene || scene === 'logos') bloom(display, { threshold: 65, intensity: 0.85, radius: 2, passes: 2 });

  const W = display.width;
  const H = display.height;
  const header = `P6\n${W} ${H}\n255\n`;
  const body = Buffer.alloc(W * H * 3);
  const c = display.color;
  for (let i = 0; i < W * H * 3; i++) {
    const v = c[i];
    body[i] = v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v);
  }
  writeFileSync(out, Buffer.concat([Buffer.from(header, 'ascii'), body]));
  console.log(`wrote ${out} (${W}x${H})`);
}

// Dispatch at the bottom so the module-level consts above are initialized before
// a subcommand function runs (function declarations hoist; const/let do not).
if (process.argv[2] === 'ui') {
  uiSnapshot();
} else if (process.argv[2] === 'overlay') {
  overlaySnapshot();
} else if (process.argv[2] === 'unified') {
  unifiedSnapshot();
} else if (process.argv[2] === 'modal') {
  modalSnapshot();
} else if (process.argv[2] === 'showcase') {
  showcaseSnapshot();
} else {
  sceneSnapshot();
}

// The 'ui' component playground composited over the chess scene via the real
// Screen (so Slots expand to their live components). `focus=<id>` focuses one
// component so its focused styling (caret/highlight/thumb) shows.
function showcaseSnapshot(): void {
  const args = process.argv.slice(3);
  const cols = Number(args[0]) || 110;
  const rows = Number(args[1]) || 40;
  const focusArg = args.find((a) => a.startsWith('focus='));
  const out = args.find((a) => a.endsWith('.ppm')) ?? '.snapshots/showcase.ppm';
  const SS = 3;

  const target = new RenderTarget(cols * SS, rows * 2 * SS);
  new ChessScene().renderScene(target);

  const screen = new Screen(cols, rows);
  mountShowcase(screen);
  if (focusArg) screen.setFocus(focusArg.split('=')[1]);
  const region = { x: 0, y: 0, w: cols, h: rows };
  screen.setRoot(buildShowcase(region, buildBar('ui', 'ascii', barActions)), region);
  const surf = screen.snapshot((s) => shapeGlyphToSurface(s, target, cols, rows, { color: true, hybrid: true }));
  surfaceToPpm(surf, cols, rows, out);
}

// The promotion modal composited over the chess scene via the unified path:
// scene → Surface (shape-glyph), then the Modal's scrim dims it in place while
// the popup paints crisp on top. Proves the translucent-scrim effect.
function modalSnapshot(): void {
  const cols = Number(process.argv[3]) || 110;
  const rows = Number(process.argv[4]) || 40;
  const out = process.argv[5] ?? '.snapshots/modal.ppm';
  const SS = 3;
  const target = new RenderTarget(cols * SS, rows * 2 * SS);
  new ChessGameScene().renderScene(target);
  const surf = new Surface(cols, rows);
  shapeGlyphToSurface(surf, target, cols, rows, { color: true, hybrid: true });
  const root = buildPromotion(0 as Color, () => {}); // WHITE
  layout(root, { x: 0, y: 0, w: cols, h: rows });
  paint(root, surf, { hoverId: 'promo-queen', focusId: 'promo-queen', pressedId: null });
  surfaceToPpm(surf, cols, rows, out);
}

// The unified compositing path (ASCII mode): the scene paints into the SAME
// Surface as the bar via shapeGlyphToSurface, then the bar paints over it — one
// composited cell grid, rasterized straight from the Surface. Verifies the
// scene-into-Surface port + over-the-scene compositing in one image.
function unifiedSnapshot(): void {
  const scene = (process.argv[3] as Mode) ?? 'attract';
  const cols = Number(process.argv[4]) || 110;
  const rows = Number(process.argv[5]) || 40;
  const out = process.argv[6] ?? `.snapshots/unified-${scene}.ppm`;
  const SS = 3;

  const target = new RenderTarget(cols * SS, rows * 2 * SS);
  if (scene === 'chess') new ChessScene().renderScene(target);
  else if (scene === 'chess-game') new ChessGameScene().renderScene(target);
  else if (scene === 'logos') new LogosScene().renderScene(target, 0.6);
  else new AttractScene().renderScene(target, 0.6);

  const surf = new Surface(cols, rows);
  shapeGlyphToSurface(surf, target, cols, rows, { color: true, hybrid: scene !== 'attract' && scene !== 'logos' });
  const root = buildBar(scene, 'ascii', barActions);
  layout(root, { x: 0, y: rows - 2, w: cols, h: 1 });
  paint(root, surf, { hoverId: 'reset', focusId: null, pressedId: null });

  surfaceToPpm(surf, cols, rows, out);
}
