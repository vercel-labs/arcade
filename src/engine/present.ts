import type { RenderTarget } from './framebuffer.ts';
import { GH, GW, matchGlyph } from './glyph.ts';

// Serializes a render target to a single ANSI string using the upper half-block
// ▀: foreground = top pixel, background = bottom pixel, so each terminal cell
// shows two stacked pixels. Color escapes are coalesced — only emitted when the
// color pair changes between adjacent cells — which collapses runs of identical
// background (e.g. black) to almost nothing.
export function toHalfBlock(target: RenderTarget, skipTopRows = 0): string {
  const W = target.width;
  const rows = Math.floor(target.height / 2);
  const col = target.color;
  let out = '';
  let last = '';
  for (let cy = Math.max(0, skipTopRows); cy < rows; cy++) {
    out += `\x1b[${cy + 1};1H`;
    const top = 2 * cy * W;
    const bot = (2 * cy + 1) * W;
    for (let x = 0; x < W; x++) {
      const ti = (top + x) * 3;
      const bi = (bot + x) * 3;
      const seq =
        `\x1b[38;2;${byte(col[ti])};${byte(col[ti + 1])};${byte(col[ti + 2])};` +
        `48;2;${byte(col[bi])};${byte(col[bi + 1])};${byte(col[bi + 2])}m`;
      if (seq !== last) {
        out += seq;
        last = seq;
      }
      out += '▀';
    }
  }
  return out + '\x1b[0m';
}

// Shape-matched glyph mode (per Alex Harri's "ASCII rendering"): instead of a
// luminance ramp, each cell is reduced to a GW×GH grid of brightness values and
// rendered as the character whose ink *distribution* best matches it (nearest
// in Euclidean distance). This captures shape, not just density, so silhouettes
// read as the right strokes (| / \ _ etc.) without a separate edge pass.
//
// Samples the high-resolution (pre-downsample) target so each cell has enough
// sub-cell detail; `cols`/`rows` are the terminal grid. `color` tints each glyph
// with the cell's average color. The cell vector is normalized to its own peak
// before matching (so shape, not absolute brightness, drives the glyph choice);
// `contrast` is the gamma applied to that normalized vector to sharpen edges.
export interface ShapeGlyphOptions {
  color?: boolean;
  skipTopRows?: number;
  contrast?: number;
  // > 0 enables softmax sampling among the nearest glyphs (subtle variation);
  // 0 is deterministic nearest match.
  jitterTemp?: number;
}

// Cells dimmer than this are matched deterministically even when jitter is on.
const JITTER_MIN_BRIGHTNESS = 0.25;

// Cells whose peak brightness is below this read as background and render as
// space. Scenes draw bright shapes on pure black, so any lit surface — even one
// at the ambient floor — clears this comfortably.
const EMPTY = 0.03;

export function toShapeGlyph(
  target: RenderTarget,
  cols: number,
  rows: number,
  options: ShapeGlyphOptions = {},
): string {
  const { color = true, skipTopRows = 0, contrast = 2, jitterTemp = 0 } = options;
  const W = target.width;
  const H = target.height;
  const c = target.color;
  const fw = W / cols;
  const fh = H / rows;
  const dim = GW * GH;
  const sum = new Array(dim);
  const cnt = new Array(dim);
  const vec = new Array(dim);

  let out = '';
  let last = '';
  for (let cy = Math.max(0, skipTopRows); cy < rows; cy++) {
    out += `\x1b[${cy + 1};1H`;
    const y0 = Math.floor(cy * fh);
    const y1 = Math.max(y0 + 1, Math.floor((cy + 1) * fh));
    for (let cx = 0; cx < cols; cx++) {
      const x0 = Math.floor(cx * fw);
      const x1 = Math.max(x0 + 1, Math.floor((cx + 1) * fw));
      const rw = x1 - x0;
      const rh = y1 - y0;
      sum.fill(0);
      cnt.fill(0);
      let cr = 0;
      let cg = 0;
      let cb = 0;
      let cc = 0;
      for (let y = y0; y < y1; y++) {
        const gy = Math.min(GH - 1, Math.floor(((y - y0) * GH) / rh));
        for (let x = x0; x < x1; x++) {
          const i = (y * W + x) * 3;
          const r = c[i];
          const g = c[i + 1];
          const b = c[i + 2];
          const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
          const gx = Math.min(GW - 1, Math.floor(((x - x0) * GW) / rw));
          const idx = gy * GW + gx;
          sum[idx] += lum;
          cnt[idx]++;
          cr += r;
          cg += g;
          cb += b;
          cc++;
        }
      }
      let mx = 0;
      for (let i = 0; i < dim; i++) {
        vec[i] = cnt[i] ? sum[i] / cnt[i] : 0;
        if (vec[i] > mx) mx = vec[i];
      }

      // Background gate: cells with no real brightness stay empty (space).
      if (mx < EMPTY) {
        out += ' ';
        continue;
      }

      // Match on the cell's *shape*, normalized to its own peak — not on its
      // absolute brightness. A flat-lit surface (bright OR dim) then maps to a
      // solid fill glyph, and its dimness is carried by the color tint below.
      // (Matching the absolute vector instead made a uniformly dark face — e.g.
      // one turned away from the light, sitting at the ambient floor — nearest
      // to the empty space glyph, so the whole face vanished even though it's a
      // real, visible surface. Luminance mode never had this because any nonzero
      // brightness picks a ramp char.) The gamma `contrast` still sharpens the
      // normalized vector so within-cell edges read as the right strokes.
      const inv = 1 / mx;
      for (let i = 0; i < dim; i++) vec[i] = contrast === 1 ? vec[i] * inv : Math.pow(vec[i] * inv, contrast);

      // Only jitter cells with real brightness — near-black background cells have
      // near-identical candidates (space/./,) and would just flicker as noise.
      const ch = matchGlyph(vec, mx > JITTER_MIN_BRIGHTNESS ? jitterTemp : 0);
      if (ch === ' ') {
        out += ' ';
        continue;
      }
      if (color && cc > 0) {
        const seq = `\x1b[38;2;${byte(cr / cc)};${byte(cg / cc)};${byte(cb / cc)}m`;
        if (seq !== last) {
          out += seq;
          last = seq;
        }
      }
      out += ch;
    }
  }
  return out + '\x1b[0m';
}

// Luminance mode: classic brightness → ramp character (NOT shape-matching).
// Each cell's average brightness selects a glyph from a 10-level dark→light
// ramp (index 0 = empty space). Optionally tinted with the cell's color.
export interface LuminanceOptions {
  color?: boolean;
  skipTopRows?: number;
  ramp?: string;
  edges?: boolean; // overlay Acerola-style directional edge glyphs (| / _ \)
}

const LUMINANCE_RAMP = ' .:coP0?@█';
// Edge overlay tuning — deliberately conservative so only strong, coherent
// contours become edges (raw Sobel at a low threshold is what looked noisy
// before; a DoG pre-pass + a high coverage gate keeps it clean).
const EDGE_CHARS = ['|', '/', '_', '\\'];
const DOG_THRESHOLD = 0.07;
const EDGE_COVERAGE = 0.45;
const EDGE_ASPECT = 0.5;

export function toLuminance(
  target: RenderTarget,
  cols: number,
  rows: number,
  options: LuminanceOptions = {},
): string {
  const { color = true, skipTopRows = 0, ramp = LUMINANCE_RAMP, edges = true } = options;
  const W = target.width;
  const H = target.height;
  const c = target.color;
  const fw = W / cols;
  const fh = H / rows;
  const maxIdx = ramp.length - 1;
  const edgeChars = edges ? computeEdges(target, cols, rows) : null;
  let out = '';
  let last = '';
  for (let cy = Math.max(0, skipTopRows); cy < rows; cy++) {
    out += `\x1b[${cy + 1};1H`;
    const y0 = Math.floor(cy * fh);
    const y1 = Math.max(y0 + 1, Math.floor((cy + 1) * fh));
    for (let cx = 0; cx < cols; cx++) {
      const x0 = Math.floor(cx * fw);
      const x1 = Math.max(x0 + 1, Math.floor((cx + 1) * fw));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * W + x) * 3;
          r += c[i];
          g += c[i + 1];
          b += c[i + 2];
          n++;
        }
      }
      r /= n;
      g /= n;
      b /= n;
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      const edge = edgeChars ? edgeChars[cy * cols + cx] : null;
      const ch = edge ?? ramp[Math.min(maxIdx, Math.max(0, Math.round(lum * maxIdx)))];
      if (ch === ' ') {
        out += ' ';
        continue;
      }
      if (color) {
        const seq = `\x1b[38;2;${byte(r)};${byte(g)};${byte(b)}m`;
        if (seq !== last) {
          out += seq;
          last = seq;
        }
      }
      out += ch;
    }
  }
  return out + '\x1b[0m';
}

// --- Edge overlay: Difference-of-Gaussians masks edges, Sobel gives direction,
// each cell takes the dominant direction over its footprint (a local histogram,
// like Acerola's compute-shader downscale) so edge lines stay coherent. ---
let edgeW = 0;
let edgeH = 0;
let lumBuf = new Float32Array(0);
let blurA = new Float32Array(0);
let blurB = new Float32Array(0);
let blurTmp = new Float32Array(0);

function ensureEdgeBuffers(w: number, h: number): void {
  if (w === edgeW && h === edgeH) return;
  edgeW = w;
  edgeH = h;
  const n = w * h;
  lumBuf = new Float32Array(n);
  blurA = new Float32Array(n);
  blurB = new Float32Array(n);
  blurTmp = new Float32Array(n);
}

function boxBlur(src: Float32Array, dst: Float32Array, w: number, h: number, r: number): void {
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let d = -r; d <= r; d++) s += src[row + (x + d < 0 ? 0 : x + d >= w ? w - 1 : x + d)];
      blurTmp[row + x] = s * inv;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let s = 0;
      for (let d = -r; d <= r; d++) s += blurTmp[(y + d < 0 ? 0 : y + d >= h ? h - 1 : y + d) * w + x];
      dst[y * w + x] = s * inv;
    }
  }
}

function sobelBucket(x: number, y: number, w: number, h: number): number {
  const cx = (v: number) => (v < 0 ? 0 : v >= w ? w - 1 : v);
  const cy = (v: number) => (v < 0 ? 0 : v >= h ? h - 1 : v);
  const L = (xx: number, yy: number): number => lumBuf[cy(yy) * w + cx(xx)];
  const gx = L(x + 1, y - 1) + 2 * L(x + 1, y) + L(x + 1, y + 1) - (L(x - 1, y - 1) + 2 * L(x - 1, y) + L(x - 1, y + 1));
  const gy = L(x - 1, y + 1) + 2 * L(x, y + 1) + L(x + 1, y + 1) - (L(x - 1, y - 1) + 2 * L(x, y - 1) + L(x + 1, y - 1));
  if (gx === 0 && gy === 0) return -1;
  const a = ((Math.atan2(gy * EDGE_ASPECT, gx) * 180) / Math.PI + 180) % 180;
  if (a < 22.5 || a >= 157.5) return 0; // | vertical edge
  if (a < 67.5) return 1; // /
  if (a < 112.5) return 2; // _ horizontal edge
  return 3; // \
}

function computeEdges(target: RenderTarget, cols: number, rows: number): (string | null)[] {
  const W = target.width;
  const H = target.height;
  const c = target.color;
  ensureEdgeBuffers(W, H);
  for (let i = 0, p = 0; i < W * H; i++, p += 3) {
    lumBuf[i] = (0.299 * c[p] + 0.587 * c[p + 1] + 0.114 * c[p + 2]) / 255;
  }
  boxBlur(lumBuf, blurA, W, H, 1);
  boxBlur(lumBuf, blurB, W, H, 2);

  const result: (string | null)[] = new Array(cols * rows).fill(null);
  const fw = W / cols;
  const fh = H / rows;
  for (let cyc = 0; cyc < rows; cyc++) {
    const y0 = Math.floor(cyc * fh);
    const y1 = Math.max(y0 + 1, Math.floor((cyc + 1) * fh));
    for (let cxc = 0; cxc < cols; cxc++) {
      const x0 = Math.floor(cxc * fw);
      const x1 = Math.max(x0 + 1, Math.floor((cxc + 1) * fw));
      const hist = [0, 0, 0, 0];
      let edgePixels = 0;
      let total = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          total++;
          if (Math.abs(blurA[y * W + x] - blurB[y * W + x]) > DOG_THRESHOLD) {
            const bucket = sobelBucket(x, y, W, H);
            if (bucket >= 0) {
              hist[bucket]++;
              edgePixels++;
            }
          }
        }
      }
      if (total > 0 && edgePixels / total >= EDGE_COVERAGE) {
        let best = 0;
        for (let k = 1; k < 4; k++) if (hist[k] > hist[best]) best = k;
        result[cyc * cols + cxc] = EDGE_CHARS[best];
      }
    }
  }
  return result;
}

function byte(v: number): number {
  if (v <= 0) return 0;
  if (v >= 255) return 255;
  return Math.round(v);
}
