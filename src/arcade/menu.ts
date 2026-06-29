// The Wii-style menu hub: a horizontally-scrolling shelf of fixed-aspect tiles
// (clean TUI rectangles, not ASCII art) drawn over the dimmed prism. The number
// of rows adapts to terminal height; tiles keep a ~3:2 visual ratio and scale,
// and overflow is reached by panning (scroll wheel) — selection auto-pans too.
//
// This module is pure presentation + layout + hit-testing: it draws into a
// Surface and computes geometry. main.ts owns selection/scroll state and wires
// each enabled tile's launch action by id.

import { readFileSync } from 'node:fs';
import { decodePng, RenderTarget, type RGB, shapeGlyphToSurface, Surface, STYLE_BOLD, STYLE_DIM, type Texture } from '../engine/index.ts';

export interface MenuItem {
  id: string;
  title: string;
  enabled: boolean; // false → placeholder (dimmed, no-op)
}

// Order: functional games first (chess top-left), then placeholders.
export const MENU_ITEMS: MenuItem[] = [
  { id: 'chess', title: 'Chess', enabled: true },
  { id: 'logos', title: 'Logos', enabled: true },
  { id: 'audio', title: 'Audio', enabled: true },
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

// Nearest texel (point sample) as RGBA bytes — keeps pixel-art colors pure and
// edges hard when sampling per braille dot.
function texAt(tex: Texture, u: number, v: number): [number, number, number, number] {
  const x = clamp(Math.floor(u * tex.width), 0, tex.width - 1);
  const y = clamp(Math.floor(v * tex.height), 0, tex.height - 1);
  const i = (y * tex.width + x) * 4;
  return [tex.data[i], tex.data[i + 1], tex.data[i + 2], tex.data[i + 3]];
}

interface ArtCell {
  ch: string;
  col: RGB | null; // null → empty cell (show the field through)
}

// Render the tile art with the SAME colored shape-matched ASCII the scenes use:
// blit the icon (contained, centered) into a small black RenderTarget — its
// near-black/transparent backdrop stays black so the matcher reads it as empty —
// run the engine glyph matcher, and keep each non-empty cell's glyph + color.
// Cached per (id, size) since the menu redraws every frame behind the live prism.
const SSX = 3; // render-target pixels per cell (matches the scene supersample)
const SSY = 6;
const artCache = new Map<string, ArtCell[]>();
function colorAsciiCells(tex: Texture, id: string, w: number, h: number): ArtCell[] {
  const key = `${id}:${w}x${h}`;
  const hit = artCache.get(key);
  if (hit) return hit;

  const tw = w * SSX;
  const th = h * SSY;
  const tgt = new RenderTarget(tw, th);
  tgt.clear(0, 0, 0);
  const size = Math.floor(Math.min(tw, th) * 0.9); // contain the square icon
  const ox = Math.floor((tw - size) / 2);
  const oy = Math.floor((th - size) / 2);
  const col = tgt.color;
  for (let py = 0; py < th; py++) {
    for (let px = 0; px < tw; px++) {
      const u = (px - ox) / size;
      const v = (py - oy) / size;
      if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
      const c = texAt(tex, u, v);
      if (c[3] < 128 || c[0] + c[1] + c[2] < 40) continue; // transparent / near-black backdrop → stays empty
      const i = (py * tw + px) * 3;
      col[i] = c[0];
      col[i + 1] = c[1];
      col[i + 2] = c[2];
    }
  }

  const temp = new Surface(w, h);
  shapeGlyphToSurface(temp, tgt, w, h, { color: true, contrast: 2, hybrid: false });
  const cells: ArtCell[] = new Array(w * h);
  for (let cy = 0; cy < h; cy++) {
    for (let cx = 0; cx < w; cx++) {
      const cell = temp.getCell(cx, cy);
      cells[cy * w + cx] = cell && cell.ch !== ' ' ? { ch: cell.ch, col: cell.fg } : { ch: ' ', col: null };
    }
  }
  artCache.set(key, cells);
  return cells;
}

// Draw the cached ASCII art into the tile; `bright` scales the glyph colors (dimming
// unselected tiles); empty cells fall through to `field`.
function blitColorAscii(surf: Surface, sx: number, y: number, w: number, h: number, tex: Texture, id: string, field: RGB, bright: number): void {
  const cells = colorAsciiCells(tex, id, w, h);
  for (let cy = 0; cy < h; cy++) {
    for (let cx = 0; cx < w; cx++) {
      const cell = cells[cy * w + cx];
      const fg: RGB = cell.col ? [cell.col[0] * bright, cell.col[1] * bright, cell.col[2] * bright] : field;
      surf.setCell(sx + cx, y + cy, cell.ch, fg, field);
    }
  }
}

// A tile: the art as colored shape-matched ASCII over a dark field (or a solid fill
// if no art), with the title on a small chip. Selection brightens + accents.
function drawTile(surf: Surface, sx: number, y: number, w: number, h: number, item: MenuItem, selected: boolean): void {
  const dis = !item.enabled;
  const tex = gameTex(item.id);
  const field: RGB = selected ? [52, 60, 90] : [30, 34, 46];
  if (tex) {
    blitColorAscii(surf, sx, y, w, h, tex, item.id, field, selected ? 1 : dis ? 0.6 : 0.9);
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
