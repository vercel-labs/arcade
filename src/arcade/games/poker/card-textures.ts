// Procedural playing-card textures for the cards screen. Each card FACE is drawn
// into an opaque RGBA texture — white stock, corner indices (rank + suit pip, and
// a 180°-rotated copy in the opposite corner), and a canonical center pip layout —
// which the `coverMaterial` billboard samples. Suit pips are sampled from per-suit
// PNGs (spade/heart/diamond/club) reduced to a coverage mask and tinted with the
// card's ink, so the club keeps the lobe gaps a procedural blob loses once the
// terminal down-samples the card.
//
// The BACK reuses the bundled Bicycle scan, recolored purple→red at load: the
// design is white line-art on a field, so a luminance ramp maps the field to a
// deep card red and keeps the white filigree.

import { readFileSync } from 'node:fs';
import { decodePng, FONT, type RGB, type Texture } from '../../../engine/index.ts';
import { type Card, isRed, RANK_LABELS } from '../../../rules/poker/cards.ts';

// Card face resolution (5:7, a real card's ratio). Big enough that pips + indices
// stay clean once the terminal down-samples them.
const FW = 250;
const FH = 350;

const CARD_WHITE: RGB = [252, 250, 246];
const INK_BLACK: RGB = [14, 14, 18];
const INK_RED: RGB = [208, 20, 34];
const BACK_RED: RGB = [156, 22, 30]; // the field the purple scan is remapped to

// ── low-level texture writes ────────────────────────────────────────────────────

// Alpha-blend `rgb` over the existing pixel (the face starts opaque white, so ink
// composites onto stock). Out-of-bounds writes are ignored.
function blend(data: Uint8Array, w: number, h: number, x: number, y: number, rgb: RGB, a: number): void {
  if (a <= 0 || x < 0 || y < 0 || x >= w || y >= h) return;
  const i = (y * w + x) * 4;
  const k = a >= 1 ? 1 : a;
  data[i] = data[i] * (1 - k) + rgb[0] * k;
  data[i + 1] = data[i + 1] * (1 - k) + rgb[1] * k;
  data[i + 2] = data[i + 2] * (1 - k) + rgb[2] * k;
  data[i + 3] = 255;
}

// A pixel-plot sink; `drawCorner` swaps in a 180°-rotated one for the far corner.
type Put = (x: number, y: number, rgb: RGB, a: number) => void;

// ── suit pips (sampled from per-suit PNGs) ──────────────────────────────────────
// Each suit is a white-background PNG reduced once to a coverage mask (distance from
// white, so a red pip keys as strongly as a black one) and trimmed to its inked
// bounding box, so every suit stamps centered with equal visual weight regardless of
// its native margins. `stampPip` fits that box into the pip's target rect.

const SUIT_DIR = 'public/assets/poker';
// Indexed by suit (SPADES=0, HEARTS=1, DIAMONDS=2, CLUBS=3).
const SUIT_FILES = ['spade', 'heart', 'diamond', 'club'] as const;

interface SuitMask {
  w: number;
  h: number;
  cov: Float32Array; // 0..1 ink coverage, row-major w×h
  bx: number; // inked bounding box within the image
  by: number;
  bw: number;
  bh: number;
}

let suitMasks: SuitMask[] | null = null;

function buildSuitMask(src: Texture): SuitMask {
  const { width: w, height: h, data } = src;
  const cov = new Float32Array(w * h);
  let bx0 = w, by0 = h, bx1 = -1, by1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      // Distance from white via the min channel: white→0, black→1, saturated red
      // →~0.9. A soft threshold drops the white field and any residual edge haze.
      const raw = 1 - Math.min(data[i], data[i + 1], data[i + 2]) / 255;
      const c = raw <= 0.25 ? 0 : raw >= 0.75 ? 1 : (raw - 0.25) / 0.5;
      cov[y * w + x] = c;
      if (c > 0.5) {
        if (x < bx0) bx0 = x;
        if (x > bx1) bx1 = x;
        if (y < by0) by0 = y;
        if (y > by1) by1 = y;
      }
    }
  }
  return { w, h, cov, bx: bx0, by: by0, bw: bx1 - bx0 + 1, bh: by1 - by0 + 1 };
}

function loadSuitMasks(): SuitMask[] {
  if (!suitMasks) suitMasks = SUIT_FILES.map((name) => buildSuitMask(decodePng(readFileSync(`${SUIT_DIR}/${name}.png`))));
  return suitMasks;
}

// Bilinear sample of a mask's coverage at fractional (x,y) in image pixels.
function sampleCov(m: SuitMask, x: number, y: number): number {
  if (x < 0) x = 0; else if (x > m.w - 1) x = m.w - 1;
  if (y < 0) y = 0; else if (y > m.h - 1) y = m.h - 1;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1 < m.w ? x0 + 1 : x0;
  const y1 = y0 + 1 < m.h ? y0 + 1 : y0;
  const fx = x - x0;
  const fy = y - y0;
  const top = m.cov[y0 * m.w + x0] * (1 - fx) + m.cov[y0 * m.w + x1] * fx;
  const bot = m.cov[y1 * m.w + x0] * (1 - fx) + m.cov[y1 * m.w + x1] * fx;
  return top * (1 - fy) + bot * fy;
}

// Stamp a suit pip centered at (cx,cy) px, fitting the mask's inked box (aspect
// preserved) into the given half-extents. 2×2 supersampling antialiases the edge;
// `invert` flips it vertically (lower-half pips are traditionally upside-down).
function stampPip(put: Put, suit: number, cx: number, cy: number, hw: number, hh: number, rgb: RGB, invert: boolean): void {
  const m = loadSuitMasks()[suit];
  const scale = Math.min((2 * hw) / m.bw, (2 * hh) / m.bh); // contain within the box
  const dw = m.bw * scale;
  const dh = m.bh * scale;
  const left = cx - dw / 2;
  const top = cy - dh / 2;
  const x0 = Math.floor(left) - 1;
  const x1 = Math.ceil(left + dw) + 1;
  const y0 = Math.floor(top) - 1;
  const y1 = Math.ceil(top + dh) + 1;
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      let acc = 0;
      for (let sy = 0; sy < 2; sy++) {
        for (let sx = 0; sx < 2; sx++) {
          let u = (px + 0.25 + sx * 0.5 - left) / dw;
          let v = (py + 0.25 + sy * 0.5 - top) / dh;
          if (u < 0 || u > 1 || v < 0 || v > 1) continue;
          if (invert) v = 1 - v;
          acc += sampleCov(m, m.bx + u * m.bw, m.by + v * m.bh);
        }
      }
      if (acc > 0.01) put(px, py, rgb, acc / 4);
    }
  }
}

// Stamp an 8×8 font glyph at `scale` (nearest-neighbor). `bold` dilates each lit
// cell by 1px (right + down) so the thin bitmap strokes survive the terminal's
// down-sampling. Returns the glyph's advance width.
function stampGlyph(put: Put, ch: string, x: number, y: number, scale: number, rgb: RGB, bold = false): number {
  const g = FONT[ch] ?? FONT['?'];
  const ext = bold ? 1 : 0;
  for (let r = 0; r < 8; r++) {
    const bits = g[r];
    for (let c = 0; c < 8; c++) {
      if (bits[c] !== '1') continue;
      for (let dy = 0; dy < scale + ext; dy++) for (let dx = 0; dx < scale + ext; dx++) put(x + c * scale + dx, y + r * scale + dy, rgb, 1);
    }
  }
  return 8 * scale;
}

// The corner block: a big, bold rank label (left-aligned) with a suit pip centered
// beneath it. Sized like a casino "jumbo index" deck so it stays legible once the
// terminal down-samples the card. Drawn at a fixed top-left origin; the far corner
// passes a rotated `put`. The pip is centered on the label's *inked* columns (not
// the glyph cell, which would drift it right) and dropped a clear gap below the
// lowest inked row, so it never rides up into the number — for one- or two-digit ranks.
function drawCorner(put: Put, card: Card, ink: RGB): void {
  const label = RANK_LABELS[card.rank];
  const gs = 5;
  const x = 7; // tucked close to the corner (the card's margin is thin, see drawCard)
  const y = 6;
  let cx = x;
  let inkL = Infinity;
  let inkR = -Infinity;
  let inkB = -Infinity; // lowest inked pixel row across the label
  for (const ch of label) {
    const g = FONT[ch] ?? FONT['?'];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (g[r][c] !== '1') continue;
        inkL = Math.min(inkL, cx + c * gs);
        inkR = Math.max(inkR, cx + (c + 1) * gs);
        inkB = Math.max(inkB, y + (r + 1) * gs);
      }
    }
    stampGlyph(put, ch, cx, y, gs, ink, true);
    cx += 8 * gs - gs * 2; // advance with a −2gs kern so a two-digit "10" stays compact
  }
  const pipHh = 13;
  const pipCx = inkR > inkL ? (inkL + inkR) / 2 : x + 4 * gs;
  const pipCy = (inkB > -Infinity ? inkB : y + 7 * gs) + 9 + pipHh; // 9px gap below the number
  stampPip(put, card.suit, pipCx, pipCy, 11, pipHh, ink, false);
}

// ── center pip layouts ──────────────────────────────────────────────────────────
// [colFrac, rowFrac] of the card, per rank index (0=A … 9=Ten). Court cards get a
// large letter instead (empty here).
const L = 0.32;
const C = 0.5;
const R = 0.68;
const PIPS: [number, number][][] = [
  [[C, 0.5]], // A (big center pip)
  [[C, 0.23], [C, 0.77]], // 2
  [[C, 0.23], [C, 0.5], [C, 0.77]], // 3
  [[L, 0.23], [R, 0.23], [L, 0.77], [R, 0.77]], // 4
  [[L, 0.23], [R, 0.23], [C, 0.5], [L, 0.77], [R, 0.77]], // 5
  [[L, 0.23], [R, 0.23], [L, 0.5], [R, 0.5], [L, 0.77], [R, 0.77]], // 6
  [[L, 0.23], [R, 0.23], [C, 0.35], [L, 0.5], [R, 0.5], [L, 0.77], [R, 0.77]], // 7
  [[L, 0.23], [R, 0.23], [C, 0.35], [L, 0.5], [R, 0.5], [C, 0.65], [L, 0.77], [R, 0.77]], // 8
  [[L, 0.23], [R, 0.23], [L, 0.4], [R, 0.4], [C, 0.5], [L, 0.6], [R, 0.6], [L, 0.77], [R, 0.77]], // 9
  [[L, 0.23], [R, 0.23], [C, 0.32], [L, 0.4], [R, 0.4], [L, 0.6], [R, 0.6], [C, 0.68], [L, 0.77], [R, 0.77]], // 10
];

function drawCenter(put: Put, card: Card, ink: RGB): void {
  const layout = PIPS[card.rank];
  if (!layout) {
    // Court card (J/Q/K): a large index letter with a suit pip beneath.
    const label = RANK_LABELS[card.rank];
    const gs = 12;
    stampGlyph(put, label, (FW - 8 * gs) / 2, FH * 0.32, gs, ink);
    stampPip(put, card.suit, FW / 2, FH * 0.66, 26, 32, ink, false);
    return;
  }
  const big = card.rank === 0; // the Ace's single pip is oversized
  const hw = big ? 40 : 20;
  const hh = big ? 50 : 26;
  for (const [cf, rf] of layout) stampPip(put, card.suit, cf * FW, rf * FH, hw, hh, ink, rf > 0.5);
}

// ── public builders (cached) ────────────────────────────────────────────────────

const faceCache = new Map<string, Texture>();

export function cardFaceTexture(card: Card): Texture {
  const key = `${card.rank}:${card.suit}`;
  const hit = faceCache.get(key);
  if (hit) return hit;
  const data = new Uint8Array(FW * FH * 4);
  for (let i = 0; i < FW * FH; i++) {
    data[i * 4] = CARD_WHITE[0];
    data[i * 4 + 1] = CARD_WHITE[1];
    data[i * 4 + 2] = CARD_WHITE[2];
    data[i * 4 + 3] = 255;
  }
  const ink = isRed(card) ? INK_RED : INK_BLACK;
  const put: Put = (x, y, rgb, a) => blend(data, FW, FH, x, y, rgb, a);
  const putRot: Put = (x, y, rgb, a) => blend(data, FW, FH, FW - 1 - x, FH - 1 - y, rgb, a);
  drawCenter(put, card, ink);
  drawCorner(put, card, ink);
  drawCorner(putRot, card, ink); // opposite corner, rotated 180°
  const tex: Texture = { width: FW, height: FH, data };
  faceCache.set(key, tex);
  return tex;
}

let backTex: Texture | null = null;

// The card back: the bundled Bicycle scan, recolored from purple to red by
// luminance (white line-art stays white; the field becomes deep red). Contrast is
// stretched so the mid purple lands as a saturated red rather than muddy pink.
export function cardBackTexture(dir = 'public/assets/poker'): Texture {
  if (backTex) return backTex;
  const src = decodePng(readFileSync(`${dir}/playing-card-back.png`));
  const out = new Uint8Array(src.width * src.height * 4);
  for (let i = 0; i < src.width * src.height; i++) {
    const r = src.data[i * 4];
    const g = src.data[i * 4 + 1];
    const b = src.data[i * 4 + 2];
    const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const t = Math.max(0, Math.min(1, (luma - 0.28) / 0.5)); // stretch contrast
    out[i * 4] = BACK_RED[0] + (250 - BACK_RED[0]) * t;
    out[i * 4 + 1] = BACK_RED[1] + (248 - BACK_RED[1]) * t;
    out[i * 4 + 2] = BACK_RED[2] + (244 - BACK_RED[2]) * t;
    out[i * 4 + 3] = 255;
  }
  backTex = { width: src.width, height: src.height, data: out };
  return backTex;
}
