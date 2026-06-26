// The Wii-style menu hub: a horizontally-scrolling shelf of fixed-aspect tiles
// (clean TUI rectangles, not ASCII art) drawn over the dimmed prism. The number
// of rows adapts to terminal height; tiles keep a ~3:2 visual ratio and scale,
// and overflow is reached by panning (scroll wheel) — selection auto-pans too.
//
// This module is pure presentation + layout + hit-testing: it draws into a
// Surface and computes geometry. main.ts owns selection/scroll state and wires
// each enabled tile's launch action by id.

import { readFileSync } from 'node:fs';
import { blendOver, decodePng, type RGB, type RGBA, type Surface, STYLE_BOLD, STYLE_DIM, type Texture } from '../engine/index.ts';

export interface MenuItem {
  id: string;
  title: string;
  enabled: boolean; // false → placeholder (dimmed, no-op)
}

// Order: functional games first (chess top-left), then placeholders.
export const MENU_ITEMS: MenuItem[] = [
  { id: 'chess', title: 'Chess', enabled: true },
  { id: 'logos', title: 'Logos', enabled: true },
  { id: 'ui', title: 'UI', enabled: true },
  { id: 'poker', title: 'Poker', enabled: false },
  { id: 'codenames', title: 'Codenames', enabled: false },
  { id: 'pacman', title: 'Pac-Man', enabled: false },
  { id: 'frogger', title: 'Frogger', enabled: false },
  { id: 'space-invaders', title: 'Space Invaders', enabled: false },
  { id: 'street-fighter', title: 'Street Fighter', enabled: false },
];

export type MenuDir = 'left' | 'right' | 'up' | 'down';

export interface TileRect {
  index: number;
  x: number; // content-space (shelf-relative, pre-scroll) left
  y: number; // absolute screen row (vertical doesn't scroll)
  w: number;
  h: number;
}

export interface MenuLayout {
  rows: number; // tiles stacked per column (R)
  tileW: number;
  tileH: number;
  gap: number;
  tiles: TileRect[];
  contentW: number; // full shelf width
  viewX: number; // viewport left (the panning window)
  viewW: number;
}

const GAP_X = 3; // horizontal gap between tile columns
const GAP_Y = 2; // vertical gap between tile rows
const TILE_MIN_H = 4;
const TILE_MAX_H = 12;
const SIDE_MARGIN = 3;
const TOP_RESERVE = 2;
const BOT_RESERVE = 2;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// Pick the row count from terminal height (short→1, taller→2, tall→3), size the
// tiles to fill the band while holding a ~3:2 visual ratio, and lay the items out
// column-major so panning right reveals whole new columns.
export function layoutMenu(cols: number, rows: number): MenuLayout {
  const count = MENU_ITEMS.length;
  const R = rows >= 46 ? 3 : rows >= 30 ? 2 : 1;
  const availH = rows - TOP_RESERVE - BOT_RESERVE;
  const tileH = clamp(Math.floor((availH - (R - 1) * GAP_Y) / R), TILE_MIN_H, TILE_MAX_H);
  // A terminal cell is ~half as wide as tall, so 3:1 in cells ≈ 3:2 on screen.
  const tileW = Math.max(12, Math.round(tileH * 3));

  const numCols = Math.ceil(count / R);
  const blockH = R * tileH + (R - 1) * GAP_Y;
  const viewY = Math.max(TOP_RESERVE, Math.floor((rows - blockH) / 2));

  const tiles: TileRect[] = [];
  for (let i = 0; i < count; i++) {
    const col = Math.floor(i / R);
    const rowInCol = i % R;
    tiles.push({
      index: i,
      x: col * (tileW + GAP_X),
      y: viewY + rowInCol * (tileH + GAP_Y),
      w: tileW,
      h: tileH,
    });
  }
  const contentW = numCols * (tileW + GAP_X) - GAP_X;
  return { rows: R, tileW, tileH, gap: GAP_X, tiles, contentW, viewX: SIDE_MARGIN, viewW: cols - 2 * SIDE_MARGIN };
}

export function menuMaxScroll(lay: MenuLayout): number {
  return Math.max(0, lay.contentW - lay.viewW);
}

export function clampScroll(scrollX: number, lay: MenuLayout): number {
  return clamp(Math.round(scrollX), 0, menuMaxScroll(lay));
}

// Pan just enough to bring the selected tile fully into the viewport.
export function scrollToShow(sel: number, scrollX: number, lay: MenuLayout): number {
  const t = lay.tiles[sel];
  if (!t) return clampScroll(scrollX, lay);
  let sx = scrollX;
  if (t.x - sx < 0) sx = t.x;
  else if (t.x + t.w - sx > lay.viewW) sx = t.x + t.w - lay.viewW;
  return clampScroll(sx, lay);
}

// Move within the column-major grid: left/right step a column (±R), up/down step
// within the current column. Returns the unchanged index if the move falls off.
export function menuMove(sel: number, dir: MenuDir, lay: MenuLayout): number {
  const R = lay.rows;
  const n = lay.tiles.length;
  let s = sel;
  if (dir === 'left') s = sel - R;
  else if (dir === 'right') s = sel + R;
  else if (dir === 'up') s = sel % R !== 0 ? sel - 1 : sel;
  else if (dir === 'down') s = sel % R !== R - 1 && sel + 1 < n ? sel + 1 : sel;
  return s < 0 || s >= n ? sel : s;
}

// Hit-test a screen cell to a tile index (accounting for the current pan), or null.
export function tileAt(lay: MenuLayout, scrollX: number, x: number, y: number): number | null {
  if (x < lay.viewX || x >= lay.viewX + lay.viewW) return null;
  for (const t of lay.tiles) {
    const sx = lay.viewX + t.x - scrollX;
    if (x >= sx && x < sx + t.w && y >= t.y && y < t.y + t.h) return t.index;
  }
  return null;
}

// Game-tile art baked to public/assets/games/<id>.png (see fetch-games.ts). Decoded
// lazily and cached; a missing file → null, and the tile falls back to a solid fill.
const texCache = new Map<string, Texture | null>();
function gameTex(id: string): Texture | null {
  const hit = texCache.get(id);
  if (hit !== undefined) return hit;
  let tex: Texture | null = null;
  try {
    tex = decodePng(readFileSync(`public/assets/games/${id}.png`));
  } catch {
    tex = null;
  }
  texCache.set(id, tex);
  return tex;
}

// Average the source texels covering the dest pixel's footprint [u0,u1)×[v0,v1)
// (uv in 0..1). Alpha-weighted so transparent texels don't bleed color, with the
// mean coverage returned as alpha — this is a proper box downsample, so shrinking a
// smooth 128px emoji to a few cells antialiases instead of dropping thin features
// (the staggering/edge-gaps that point/bilinear sampling produced).
function boxSample(tex: Texture, u0: number, v0: number, u1: number, v1: number): RGBA {
  const { width: W, height: H, data: d } = tex;
  const x0 = clamp(Math.floor(u0 * W), 0, W);
  const y0 = clamp(Math.floor(v0 * H), 0, H);
  const x1 = Math.max(x0 + 1, clamp(Math.ceil(u1 * W), 0, W));
  const y1 = Math.max(y0 + 1, clamp(Math.ceil(v1 * H), 0, H));
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  let n = 0;
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const i = (yy * W + xx) * 4;
      const al = d[i + 3] / 255;
      r += d[i] * al;
      g += d[i + 1] * al;
      b += d[i + 2] * al;
      a += al;
      n++;
    }
  }
  return a <= 0 ? [0, 0, 0, 0] : [r / a, g / a, b / a, a / n];
}

// Render the art as a blocky (half-block) field filling the tile: the icon is
// contained + centered over a flat field color, area-downsampled, then each cell
// packs two vertical pixels (▀ = top fg / bottom bg). `bright` dims unselected ones.
function blitArt(surf: Surface, sx: number, y: number, w: number, h: number, tex: Texture, field: RGB, bright: number): void {
  const ph = h * 2; // half-block doubles vertical resolution
  const size = Math.floor(Math.min(w, ph) * 0.82); // contain the square icon, padded
  const ox = (w - size) / 2;
  const oy = (ph - size) / 2;
  const px = (gx: number, gy: number): RGB => {
    let c: RGB = field;
    if (gx >= ox && gx < ox + size && gy >= oy && gy < oy + size) {
      c = blendOver(field, boxSample(tex, (gx - ox) / size, (gy - oy) / size, (gx + 1 - ox) / size, (gy + 1 - oy) / size));
    }
    return [c[0] * bright, c[1] * bright, c[2] * bright];
  };
  for (let cy = 0; cy < h; cy++) {
    for (let cx = 0; cx < w; cx++) {
      surf.setCell(sx + cx, y + cy, '▀', px(cx, cy * 2), px(cx, cy * 2 + 1));
    }
  }
}

// A tile: a blocky art background (or a solid fill if no art), with the title on a
// small solid chip so it stays legible over the busy blocks. Selection brightens
// the art + accents the chip; placeholders sit dim.
function drawTile(surf: Surface, sx: number, y: number, w: number, h: number, item: MenuItem, selected: boolean): void {
  const dis = !item.enabled;
  const tex = gameTex(item.id);
  if (tex) {
    // Field is kept clearly above black so the tile reads as a solid rectangle
    // (edges don't dissolve into the background); brightness lifts the selected one.
    const field: RGB = selected ? [62, 72, 104] : [44, 48, 62];
    blitArt(surf, sx, y, w, h, tex, field, selected ? 1 : dis ? 0.66 : 0.86);
  } else {
    surf.fillRect(sx, y, w, h, selected ? [78, 92, 150] : dis ? [40, 42, 52] : [52, 56, 72]);
  }

  // Title on a small chip (the "rectangle" around the text), tucked into the
  // bottom-right corner so it doesn't cover the art.
  const inner = w - 2;
  const title = item.title.length > inner ? item.title.slice(0, inner) : item.title;
  const chipW = Math.min(w, title.length + 2);
  const cx = Math.max(sx, sx + w - chipW - 1);
  const cy = y + h - 2;
  const chipBg: RGB = selected ? [86, 100, 162] : [12, 14, 20];
  const fg: RGB = dis ? [170, 176, 192] : [240, 244, 255];
  surf.fillRect(cx, cy, chipW, 1, chipBg);
  const tx = cx + Math.max(0, Math.floor((chipW - title.length) / 2));
  surf.drawText(tx, cy, title, fg, chipBg, (selected ? STYLE_BOLD : 0) | (dis ? STYLE_DIM : 0));
}

// Paint the shelf over the (undimmed) scene: tiles clipped to the viewport so
// partially-panned ones clip at the edges, edge chevrons when more is off-screen,
// and a hint row.
export function drawMenu(surf: Surface, cols: number, rows: number, lay: MenuLayout, sel: number, scrollX: number): void {
  surf.setClip({ x: lay.viewX, y: 0, w: lay.viewW, h: rows });
  for (const t of lay.tiles) {
    const sx = lay.viewX + t.x - scrollX;
    if (sx + t.w <= lay.viewX || sx >= lay.viewX + lay.viewW) continue; // fully off-screen
    drawTile(surf, sx, t.y, t.w, t.h, MENU_ITEMS[t.index], t.index === sel);
  }
  surf.setClip(null);

  // Chevrons signalling more tiles past either edge.
  const midY = lay.tiles.length ? lay.tiles[0].y + Math.floor(lay.tileH / 2) : Math.floor(rows / 2);
  const chev: RGB = [200, 208, 230];
  const bg: RGB = [8, 10, 16];
  if (scrollX > 0) surf.setCell(0, midY, '‹', chev, bg, STYLE_BOLD);
  if (scrollX < menuMaxScroll(lay)) surf.setCell(cols - 1, midY, '›', chev, bg, STYLE_BOLD);

  // Bottom hint.
  const hint = '↔ scroll   ⏎ select   esc back';
  const hx = Math.max(0, Math.floor((cols - hint.length) / 2));
  surf.drawText(hx, rows - 1, hint, [120, 126, 142], [8, 10, 16], STYLE_DIM);
}
