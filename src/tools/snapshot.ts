// Headless render of a frame to a PPM image (convert to PNG with `sips`). Lets
// rendered output be viewed as an image instead of a live TTY.
//
//   pnpm exec tsx src/tools/snapshot.ts [cols] [rows] [t] [out.ppm]
//   pnpm exec tsx src/tools/snapshot.ts chess [cols] [rows] [out.ppm]
//   pnpm exec tsx src/tools/snapshot.ts ui [cols] [rows] [hover=<id>|focus=<id>] [out.ppm]
import { writeFileSync } from 'node:fs';
import { bloom, downsample, RenderTarget, Surface } from '../engine/index.ts';
import { FONT } from '../engine/font8x8.ts';
import { AttractScene } from '../arcade/attract.ts';
import { ChessScene } from '../arcade/chess.ts';
import { ChessGameScene } from '../arcade/chess-game.ts';
import { buildBar } from '../arcade/bars.ts';
import { layout, paint, type PaintState } from '../tui/index.ts';

if (process.argv[2] === 'ui') {
  uiSnapshot();
} else {
  sceneSnapshot();
}

// Rasterize the button-bar tree (laid out + painted onto a Surface) to a PPM,
// stamping glyphs from the 8x8 bitmap font. Verifies layout, centering, wide
// chars, and hover/focus styling without a live TTY.
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

  const noop = (): void => {};
  const root = buildBar('attract', 'ascii', {
    start: noop, chess: noop, chessGame: noop, demo: noop, back: noop, reset: noop, mode: noop, quit: noop,
  });
  const surf = new Surface(cols, rows);
  layout(root, { x: 0, y: rows - 2, w: cols, h: 1 });
  paint(root, surf, state);

  // One terminal cell → CW×CH pixels; the 8x8 glyph stamps into the top-left.
  const CW = 8;
  const CH = 8;
  const W = cols * CW;
  const H = rows * CH;
  const body = Buffer.alloc(W * H * 3); // black background
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const cell = surf.getCell(cx, cy);
      if (!cell || !cell.opaque) continue;
      const glyph = FONT[cell.ch];
      for (let py = 0; py < CH; py++) {
        const bits = glyph?.[py] ?? '';
        for (let px = 0; px < CW; px++) {
          const ink = bits[px] === '1';
          const [r, g, b] = ink ? cell.fg : cell.bg;
          const i = ((cy * CH + py) * W + (cx * CW + px)) * 3;
          body[i] = r;
          body[i + 1] = g;
          body[i + 2] = b;
        }
      }
    }
  }
  writeFileSync(out, Buffer.concat([Buffer.from(`P6\n${W} ${H}\n255\n`, 'ascii'), body]));
  console.log(`wrote ${out} (${W}x${H})`);
}

function sceneSnapshot(): void {
  const scene = process.argv[2] === 'chess' || process.argv[2] === 'chess-game' ? process.argv[2] : null;
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
  } else {
    new AttractScene().renderScene(target, t);
  }
  const display = downsample(target, SS);
  if (!scene) bloom(display, { threshold: 65, intensity: 0.85, radius: 2, passes: 2 });

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
