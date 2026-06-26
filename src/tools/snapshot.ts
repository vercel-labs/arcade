// Headless render of a frame to a PPM image (convert to PNG with `sips`). Lets
// rendered output be viewed as an image instead of a live TTY.
//
//   pnpm exec tsx src/tools/snapshot.ts [cols] [rows] [t] [out.ppm]
//   pnpm exec tsx src/tools/snapshot.ts chess [cols] [rows] [out.ppm]
//   pnpm exec tsx src/tools/snapshot.ts ui [cols] [rows] [hover=<id>|focus=<id>] [out.ppm]
//   pnpm exec tsx src/tools/snapshot.ts overlay [chess|chess-game|prism] [cols] [rows] [out.ppm]
import { writeFileSync } from 'node:fs';
import { bloom, downsample, halfBlockToSurface, RenderTarget, shapeGlyphToSurface, Surface } from '../engine/index.ts';
import { FONT } from '../engine/font8x8.ts';
import { PrismScene } from '../arcade/prism.ts';
import { SplashScene } from '../arcade/splash.ts';
import { clampScroll, drawMenu, layoutMenu } from '../arcade/menu.ts';
import { ChessScene } from '../arcade/chess.ts';
import { ChessGameScene } from '../arcade/chess-game.ts';
import { LogosScene } from '../arcade/logos-scene.ts';
import { buildBar, buildGameOver, buildPromotion, type Mode } from '../arcade/bars.ts';
import { buildShowcase, mountShowcase } from '../arcade/ui-showcase.ts';
import { buildChessGameRoot, mountChessHud, refreshMoveHistory } from '../arcade/chess-hud.ts';
import { buildMatchSetup, mountMatchSetup } from '../arcade/match-setup.ts';
import { providers } from '../arcade/models.ts';
import type { Color } from '../games/chess/types.ts';
import { Dropdown, layout, paint, Screen, type PaintState } from '../tui/index.ts';

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
const barActions = { chessGame: noop, demo: noop, logos: noop, ui: noop, back: noop, reset: noop, mode: noop, quit: noop, aiMatch: noop, resetGame: noop, illegalMoves: noop };

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
  else new PrismScene().renderScene(target, 0.6);
  const display = downsample(target, SS);
  if (scene === 'prism') bloom(display, { threshold: 65, intensity: 0.85, radius: 2, passes: 2 });

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

  const root = buildBar('prism', 'ascii', barActions);
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
  const out = args[3] || `.snapshots/${scene ?? 'prism'}.ppm`;
  const SS = 3;

  const target = new RenderTarget(cols * SS, (rows - 1) * 2 * SS);
  if (scene === 'chess') {
    new ChessScene().renderScene(target);
  } else if (scene === 'chess-game') {
    const cg = new ChessGameScene();
    if (process.argv.includes('match')) {
      // Spin up the AI HUD and play a few opening moves (applied directly — no
      // animation wait) so the still shows a live board with the side-to-move
      // wisp pulsing.
      cg.beginMatch();
      for (const san of ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']) {
        const m = cg.state().actionFromString(san);
        if (m) cg.state().applyAction(m);
      }
    }
    cg.renderScene(target, t);
  } else if (scene === 'logos') {
    new LogosScene().renderScene(target, t);
  } else {
    new PrismScene().renderScene(target, t);
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
} else if (process.argv[2] === 'chess-overlay') {
  chessOverlaySnapshot();
} else if (process.argv[2] === 'gameover') {
  gameOverSnapshot();
} else if (process.argv[2] === 'setup') {
  setupSnapshot();
} else if (process.argv[2] === 'king-anim') {
  kingAnimSnapshot();
} else if (process.argv[2] === 'splash') {
  splashSnapshot();
} else if (process.argv[2] === 'menu') {
  menuSnapshot();
} else if (process.argv[2] === 'attract') {
  attractSnapshot();
} else {
  sceneSnapshot();
}

// The Wii-style menu hub over the dimmed prism (the live unified path: scene filled
// into the Surface, then the shelf drawn on top).
//   pnpm exec tsx src/tools/snapshot.ts menu [cols] [rows] [sel] [scrollX] [out.ppm]
function menuSnapshot(): void {
  const cols = Number(process.argv[3]) || 140;
  const rows = Number(process.argv[4]) || 40;
  const sel = Number(process.argv[5]) || 0;
  const out = process.argv.find((a) => a.endsWith('.ppm')) ?? '.snapshots/menu.ppm';
  const SS = 3;
  const target = new RenderTarget(cols * SS, rows * 2 * SS);
  new PrismScene().renderScene(target, 0.6);
  const display = downsample(target, SS);
  bloom(display, { threshold: 65, intensity: 0.85, radius: 2, passes: 2 });
  const lay = layoutMenu(cols, rows);
  const scrollX = clampScroll(Number(process.argv[6]) || 0, lay);
  const surf = new Surface(cols, rows);
  halfBlockToSurface(surf, display); // fill the scene so the menu's scrim can dim it
  drawMenu(surf, cols, rows, lay, sel, scrollX);
  surfaceToPpm(surf, cols, rows, out);
}

// The prism attract marquee. `t` honors the blink (visible at t=0, hidden at t≈0.8).
//   pnpm exec tsx src/tools/snapshot.ts attract [cols] [rows] [t] [out.ppm]
function attractSnapshot(): void {
  const cols = Number(process.argv[3]) || 140;
  const rows = Number(process.argv[4]) || 40;
  const t = Number(process.argv[5]) || 0;
  const out = process.argv.find((a) => a.endsWith('.ppm')) ?? '.snapshots/attract.ppm';
  const SS = 3;
  const target = new RenderTarget(cols * SS, rows * 2 * SS);
  new PrismScene().renderScene(target, 0.6);
  const display = downsample(target, SS);
  bloom(display, { threshold: 65, intensity: 0.85, radius: 2, passes: 2 });
  const surf = new Surface(cols, rows);
  halfBlockToSurface(surf, display);
  const text = 'press any key to start';
  const alpha = 0.42 + 0.5 * (0.5 + 0.5 * Math.sin(t * Math.PI * 1.2)); // matches drawAttract
  const x0 = Math.max(0, Math.floor((cols - text.length) / 2));
  const y = rows - 2;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== ' ') surf.setCellWithAlphaBlending(x0 + i, y, text[i], [205, 210, 230, alpha], [0, 0, 0, 0]);
  }
  surfaceToPpm(surf, cols, rows, out);
}

// A single frame of the boot splash at time `t` (the intro animation). Mirrors the
// prism still (downsample + bloom) so each phase can be rendered to a PNG.
//   pnpm exec tsx src/tools/snapshot.ts splash [cols] [rows] [t] [out.ppm]
function splashSnapshot(): void {
  const cols = Number(process.argv[3]) || 110;
  const rows = Number(process.argv[4]) || 44;
  const t = Number(process.argv[5]) || 0.5;
  const out = process.argv[6] ?? '.snapshots/prism.ppm';
  const SS = 3;
  const target = new RenderTarget(cols * SS, (rows - 1) * 2 * SS);
  new SplashScene().renderScene(target, t);
  const display = downsample(target, SS);
  bloom(display, { threshold: 65, intensity: 0.85, radius: 2, passes: 2 });
  const W = display.width;
  const H = display.height;
  const body = Buffer.alloc(W * H * 3);
  const c = display.color;
  for (let i = 0; i < W * H * 3; i++) body[i] = c[i] <= 0 ? 0 : c[i] >= 255 ? 255 : Math.round(c[i]);
  writeFileSync(out, Buffer.concat([Buffer.from(`P6\n${W} ${H}\n255\n`, 'ascii'), body]));
  console.log(`wrote ${out} (${W}x${H})`);
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

// The chess-game match overlay composited over the board via the real Screen
// (so the move-history Slot expands): the AI HUD wisps + bar 'play/stop ai'
// button + the collapsible Moves panel. Pass 'min' to render the collapsed panel.
//   pnpm exec tsx src/tools/snapshot.ts chess-overlay [cols] [rows] [min] [out.ppm]
function chessOverlaySnapshot(): void {
  const args = process.argv.slice(3);
  const cols = Number(args[0]) || 140;
  const rows = Number(args[1]) || 50;
  const minimized = args.includes('min');
  const out = args.find((a) => a.endsWith('.ppm')) ?? `.snapshots/chess-overlay${minimized ? '-min' : ''}.ppm`;
  const SS = 3;
  const t = 0.7;

  const cg = new ChessGameScene();
  cg.beginMatch();
  for (const san of ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']) {
    const m = cg.state().actionFromString(san);
    if (m) cg.state().applyAction(m);
  }
  const target = new RenderTarget(cols * SS, rows * 2 * SS);
  cg.renderScene(target, t);

  const screen = new Screen(cols, rows);
  mountChessHud(screen);
  // 'empty' shows the just-spawned panel (autoHeight → header only, no empty box);
  // 'illegal' a game with illegal-toggle plies (flagged red); 'short' a few-move
  // list (panel grown to fit, no scrollbar); otherwise a long game so the panel
  // caps and the scrollbar is visible (gapless-thumb check).
  const sans = process.argv.includes('empty')
    ? []
    : process.argv.includes('illegal')
    ? ['e4', 'Nbf6', 'Bcd3', 'Nxd5', 'Qe2', 'Nxc3']
    : process.argv.includes('short')
      ? ['c4', 'c5', 'Nf3']
      : [
          'e4', 'c5', 'Nf3', 'Nc6', 'Bb5', 'Nd4', 'Nxd4', 'cxd4', 'Bxd7+', 'Qxd7', 'O-O', 'Qh3', 'gxh3', 'Bxh3', 'Qf3', 'Bg2',
          'Qxf7+', 'Kxf7', 'Kxg2', 'd3', 'cxd3', 'Nf6', 'e5', 'Ne4', 'e6+', 'Kxe6', 'dxe4', 'Rb8', 'e5', 'Kxe5', 'Re1+', 'Kf5',
          'Rxe7', 'Bxe7', 'f4', 'Kxf4', 'Rxe7', 'Kg5', 'Re5+', 'Kh6', 'Rh5+', 'Kg6', 'b4', 'a5', 'bxa5', 'Rb2+',
        ];
  // Flag the illegal-toggle plies (b8-knight to f6, c1-bishop to d3) red.
  const illegalFlags = process.argv.includes('illegal') ? [false, true, true, false, false, false] : [];
  refreshMoveHistory(sans, illegalFlags);
  const region = { x: 0, y: 0, w: cols, h: rows };
  screen.setRoot(
    buildChessGameRoot(region, buildBar('chess-game', 'ascii', barActions, { label: 'pause ai', active: true }), {
      minimized,
      onToggle: noop,
      onCopy: noop,
      commentary: { text: 'developing toward the Ruy Lopez', model: 'openai/gpt-5.4', until: 99 },
      t,
    }),
    region,
  );
  const surf = screen.snapshot((s) => shapeGlyphToSurface(s, target, cols, rows, { color: true, hybrid: true }));
  surfaceToPpm(surf, cols, rows, out);
}

// Captures a king mid-move (white castling, ~halfway through the animation) to
// verify the HUD wisp tracks the king's interpolated position rather than
// teleporting at settle. Both wisps render; the white one should sit above the
// king as it slides e1→g1.
//   pnpm exec tsx src/tools/snapshot.ts king-anim [cols] [rows] [out.ppm]
function kingAnimSnapshot(): void {
  const cols = Number(process.argv[3]) || 140;
  const rows = Number(process.argv[4]) || 50;
  const out = process.argv[5] ?? '.snapshots/king-anim.ppm';
  const SS = 3;
  const cg = new ChessGameScene();
  cg.beginMatch();
  for (const san of ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5']) {
    const m = cg.state().actionFromString(san);
    if (m) cg.state().applyAction(m);
  }
  const castle = cg.state().actionFromString('O-O');
  if (castle) void cg.playMove(castle);
  const target = new RenderTarget(cols * SS, rows * 2 * SS);
  // Pump fewer than ANIM_FRAMES (9) so the king is caught mid-slide.
  for (let i = 0; i < 4; i++) cg.renderScene(target, i / 30);
  const display = downsample(target, SS);
  const W = display.width;
  const H = display.height;
  const header = `P6\n${W} ${H}\n255\n`;
  const body = Buffer.alloc(W * H * 3);
  const c = display.color;
  for (let i = 0; i < W * H * 3; i++) body[i] = c[i] <= 0 ? 0 : c[i] >= 255 ? 255 : Math.round(c[i]);
  writeFileSync(out, Buffer.concat([Buffer.from(header, 'ascii'), body]));
  console.log(`wrote ${out} (${W}x${H})`);
}

// The AI match setup modal composited over the chess scene via the real Screen
// (so the provider/model Slots expand). Commits a model for each side so Start is
// enabled; pass `open` to also expand White's provider dropdown to show the list.
//   pnpm exec tsx src/tools/snapshot.ts setup [cols] [rows] [out.ppm] [open]
function setupSnapshot(): void {
  const cols = Number(process.argv[3]) || 120;
  const rows = Number(process.argv[4]) || 40;
  const out = process.argv[5] ?? '.snapshots/setup.ppm';
  const SS = 3;
  const target = new RenderTarget(cols * SS, rows * 2 * SS);
  new ChessGameScene().renderScene(target, 0.6);
  const screen = new Screen(cols, rows);
  mountMatchSetup(screen);
  // The modal's module defaults already pre-commit a model per side (Start enabled).
  // Optionally open a dropdown to show the expanded, scrollable picker floating
  // over the rest of the modal. `open` opens White's provider list; `models`
  // selects Google then opens White's MODEL list (long names wrap onto 2 lines).
  if (process.argv.includes('models')) {
    const wp = screen.component('setup-white-provider') as Dropdown | undefined;
    const g = providers().findIndex((p) => p.slug === 'google');
    if (g >= 0) wp?.pick(g); // switch White to Google (repopulates + clears its model)
    (screen.component('setup-white-model') as Dropdown | undefined)?.onKey?.({ name: 'enter', raw: '', sequence: '', ctrl: false, shift: false, meta: false, eventType: 'press' });
  } else if (process.argv.includes('open')) {
    const enter = { name: 'enter', raw: '', sequence: '', ctrl: false, shift: false, meta: false, eventType: 'press' as const };
    (screen.component('setup-white-provider') as Dropdown | undefined)?.onKey?.(enter);
  }
  const region = { x: 0, y: 0, w: cols, h: rows };
  screen.setRoot(buildMatchSetup(region, { onStart: noop, onCancel: noop }), region);
  const surf = screen.snapshot((s) => shapeGlyphToSurface(s, target, cols, rows, { color: true, hybrid: true }));
  surfaceToPpm(surf, cols, rows, out);
}

// The game-over result popup composited over a finished board (fool's mate, so
// the result is a real checkmate). Verifies the centered card + scrim.
//   pnpm exec tsx src/tools/snapshot.ts gameover [cols] [rows] [out.ppm]
function gameOverSnapshot(): void {
  const cols = Number(process.argv[3]) || 140;
  const rows = Number(process.argv[4]) || 50;
  const out = process.argv[5] ?? '.snapshots/gameover.ppm';
  const SS = 3;
  const cg = new ChessGameScene();
  for (const san of ['f3', 'e5', 'g4', 'Qh4']) {
    const m = cg.state().actionFromString(san);
    if (m) cg.state().applyAction(m);
  }
  const target = new RenderTarget(cols * SS, rows * 2 * SS);
  cg.renderScene(target, 0.7);
  const screen = new Screen(cols, rows);
  const region = { x: 0, y: 0, w: cols, h: rows };
  screen.setRoot(buildGameOver({ title: 'Black wins', subtitle: 'by checkmate', tint: [184, 126, 74] }, noop, noop), region);
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
  const scene = (process.argv[3] as Mode) ?? 'prism';
  const cols = Number(process.argv[4]) || 110;
  const rows = Number(process.argv[5]) || 40;
  const out = process.argv[6] ?? `.snapshots/unified-${scene}.ppm`;
  const SS = 3;

  const target = new RenderTarget(cols * SS, rows * 2 * SS);
  if (scene === 'chess') new ChessScene().renderScene(target);
  else if (scene === 'chess-game') new ChessGameScene().renderScene(target);
  else if (scene === 'logos') new LogosScene().renderScene(target, 0.6);
  else new PrismScene().renderScene(target, 0.6);

  const surf = new Surface(cols, rows);
  shapeGlyphToSurface(surf, target, cols, rows, { color: true, hybrid: scene !== 'prism' && scene !== 'logos' });
  const root = buildBar(scene, 'ascii', barActions);
  layout(root, { x: 0, y: rows - 2, w: cols, h: 1 });
  paint(root, surf, { hoverId: 'reset', focusId: null, pressedId: null });

  surfaceToPpm(surf, cols, rows, out);
}
