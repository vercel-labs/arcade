// Verifies the promotion picker: (1) the scene flow (select → pending → choose →
// queen on board), (2) the popup is centered and paints the right glyphs/colors,
// and (3) rasterizes the overlay to a PPM so the layout/colors can be eyeballed.
import { writeFileSync } from 'node:fs';
import { RenderTarget, Surface } from '../engine/index.ts';
import { FONT } from '../engine/font8x8.ts';
import { layout, paint } from '../tui/index.ts';
import { buildPromotion } from '../arcade/bars.ts';
import { ChessGameScene } from '../arcade/chess-game.ts';
import { ChessState } from '../games/chess/chess.ts';
import { BLACK, pieceColor, pieceType, QUEEN, square, WHITE } from '../games/chess/types.ts';

const cols = 140;
const rows = 50;
let fails = 0;
const ok = (c: boolean, m: string): void => {
  if (!c) fails++;
  console.log(`${c ? '✅' : '❌'} ${m}`);
};

// ── (1) Scene flow ────────────────────────────────────────────────────────────
{
  const s = new ChessGameScene() as any;
  s.game = new ChessState('8/P7/8/8/8/8/8/4K2k w - - 0 1'); // white pawn a7, ready to promote
  const a7 = square(0, 6);
  const a8 = square(0, 7);
  s.select(a7);
  const m = s.targets.get(a8);
  ok(!!m && (m.flags & 32) !== 0, 'a8 is offered as a promotion target (FLAG_PROMO)');

  s.pendingPromo = { from: a7, to: a8, color: WHITE }; // what click() sets on a promo target
  ok(s.pendingPromotion() === WHITE, 'pendingPromotion reports the pawn color');

  s.choosePromotion(QUEEN);
  ok(s.anim !== null, 'choosePromotion starts the move animation');
  const target = new RenderTarget(280, 192);
  // Render exactly while the scene reports dirty (what the orchestrator gate
  // does). A frame where the board already holds the queen AND the anim is gone
  // is the "settle" frame that actually paints the promoted piece — without it
  // the pawn lingers until the next input.
  let settleRendered = false;
  let frames = 0;
  while (s.needsRender() && frames < 30) {
    const q = s.game.board.squares[a8];
    if (s.anim === null && !!q && pieceColor(q) === WHITE && pieceType(q) === QUEEN) settleRendered = true;
    s.renderScene(target);
    frames++;
  }
  const p = s.game.board.squares[a8];
  ok(!!p && pieceColor(p) === WHITE && pieceType(p) === QUEEN, 'a8 now holds a white queen');
  ok(settleRendered, 'a settle frame paints the queen after the slide (no lingering pawn)');
  ok(!s.needsRender(), 'scene goes idle once the promoted piece is painted');
  ok(s.pendingPromotion() === null, 'no promotion pending after the choice resolves');
}

// ── (2) Popup paint + centering ───────────────────────────────────────────────
function renderPopup(color: number): Surface {
  const surf = new Surface(cols, rows);
  const root = buildPromotion(color as any, () => {});
  layout(root, { x: 0, y: 0, w: cols, h: rows });
  const popup = root.children![0].layout!;
  const cx = Math.round((cols - popup.w) / 2);
  const cy = Math.round((rows - popup.h) / 2);
  ok(Math.abs(popup.x - cx) <= 1 && Math.abs(popup.y - cy) <= 1, `popup centered (at ${popup.x},${popup.y}, size ${popup.w}×${popup.h})`);
  paint(root, surf, { hoverId: null, focusId: 'promo-queen', pressedId: null });
  return surf;
}

function findGlyph(surf: Surface, ch: string): { x: number; y: number; fg: number[] } | null {
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const c = surf.getCell(x, y);
      if (c?.opaque && c.ch === ch) return { x, y, fg: c.fg };
    }
  return null;
}

{
  const surf = renderPopup(WHITE);
  const ivory = [232, 228, 216];
  for (const g of ['♛', '♜', '♝', '♞']) {
    const hit = findGlyph(surf, g);
    ok(hit !== null && hit.fg.join() === ivory.join(), `white popup shows ${g} tinted ivory`);
  }
}
{
  const surf = renderPopup(BLACK);
  const brown = [184, 126, 74];
  const hit = findGlyph(surf, '♛');
  ok(hit !== null && hit.fg.join() === brown.join(), 'black popup tints its glyphs brown');
}

// ── (3) Rasterize the overlay to a PPM for eyeballing ───────────────────────────
{
  const surf = renderPopup(WHITE);
  const CW = 8;
  const W = cols * CW;
  const H = rows * CW;
  const img = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H * 3; i += 3) {
    img[i] = 14;
    img[i + 1] = 15;
    img[i + 2] = 20;
  } // dark "scene" backdrop
  const px = (x: number, y: number, r: number, g: number, b: number): void => {
    if (x < 0 || x >= W || y < 0 || y >= H) return;
    const o = (y * W + x) * 3;
    img[o] = r;
    img[o + 1] = g;
    img[o + 2] = b;
  };
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const c = surf.getCell(cx, cy);
      if (!c?.opaque) continue;
      for (let y = 0; y < CW; y++) for (let x = 0; x < CW; x++) px(cx * CW + x, cy * CW + y, c.bg[0], c.bg[1], c.bg[2]);
      const bmp = FONT[c.ch];
      if (bmp) {
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (bmp[y][x] === '1') px(cx * CW + x, cy * CW + y, c.fg[0], c.fg[1], c.fg[2]);
      } else if (c.ch !== ' ' && c.ch !== '') {
        // Non-ASCII (chess glyph): draw a filled marker in the fg color.
        for (let y = 1; y < 7; y++) for (let x = 1; x < 7; x++) px(cx * CW + x, cy * CW + y, c.fg[0], c.fg[1], c.fg[2]);
      }
    }
  }
  writeFileSync('.snapshots/promo.ppm', Buffer.concat([Buffer.from(`P6\n${W} ${H}\n255\n`, 'ascii'), img]));
  console.log('wrote .snapshots/promo.ppm');
}

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
