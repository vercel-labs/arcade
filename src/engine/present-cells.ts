// Cell-writing siblings of present.ts. Where present.ts serializes a RenderTarget
// straight to an ANSI string, these paint the scene INTO a Surface (one cell per
// terminal cell), so the scene becomes the bottom layer of a single composited
// grid that the UI paints over and a differ flushes. Same sampling/glyph logic
// as present.ts — when the unified path is permanent, the string presenters can
// be deleted and this becomes the only path.

import type { RenderTarget } from './framebuffer.ts';
import { GH, GW, matchGlyph } from './glyph.ts';
import type { ShapeGlyphOptions, LuminanceOptions } from './present.ts';
import type { Surface } from './surface.ts';
import type { RGB } from './color.ts';

const BLACK: RGB = [0, 0, 0];
const LUMINANCE_RAMP = ' .:coP0?@█';
const JITTER_MIN_BRIGHTNESS = 0.25;

interface PixelBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function finiteDepthBounds(target: RenderTarget): PixelBounds | null {
  const { width: W, height: H, depth } = target;
  let minX = W;
  let minY = H;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      if (!Number.isFinite(depth[row + x])) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
}

// Half-block: each cell is '▀' with fg = top pixel, bg = bottom pixel. `target`
// is the downsampled display (cols × rows*2). Reuses two scratch tuples so the
// per-cell hot path allocates nothing.
export function halfBlockToSurface(surf: Surface, target: RenderTarget, x0 = 0, y0 = 0): void {
  const W = target.width;
  const rows = Math.floor(target.height / 2);
  const c = target.color;
  const fg: RGB = [0, 0, 0];
  const bg: RGB = [0, 0, 0];
  for (let cy = 0; cy < rows; cy++) {
    const top = 2 * cy * W;
    const bot = (2 * cy + 1) * W;
    for (let x = 0; x < W; x++) {
      const ti = (top + x) * 3;
      const bi = (bot + x) * 3;
      fg[0] = c[ti];
      fg[1] = c[ti + 1];
      fg[2] = c[ti + 2];
      bg[0] = c[bi];
      bg[1] = c[bi + 1];
      bg[2] = c[bi + 2];
      surf.setCell(x0 + x, y0 + cy, '▀', fg, bg, 0);
    }
  }
}

// Sparse half-block scene layer. A finite depth value means the foreground renderer touched
// that pixel; untouched pixels stay transparent and preserve the TUI already in the Surface.
// A terminal cell is atomic, so any covered half replaces the full cell with the corresponding
// scene sample. This keeps antialiased 3D edges coherent instead of leaving half a prior glyph.
export function halfBlockLayerToSurface(surf: Surface, target: RenderTarget, x0 = 0, y0 = 0): void {
  const W = target.width;
  const rows = Math.floor(target.height / 2);
  const bounds = finiteDepthBounds(target);
  if (!bounds) return;
  const c = target.color;
  const depth = target.depth;
  const fg: RGB = [0, 0, 0];
  const bg: RGB = [0, 0, 0];
  const firstRow = Math.max(0, Math.floor(bounds.minY / 2));
  const lastRow = Math.min(rows - 1, Math.floor(bounds.maxY / 2));
  for (let cy = firstRow; cy <= lastRow; cy++) {
    const top = 2 * cy * W;
    const bot = (2 * cy + 1) * W;
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      if (!Number.isFinite(depth[top + x]) && !Number.isFinite(depth[bot + x])) continue;
      const ti = (top + x) * 3;
      const bi = (bot + x) * 3;
      fg[0] = c[ti];
      fg[1] = c[ti + 1];
      fg[2] = c[ti + 2];
      bg[0] = c[bi];
      bg[1] = c[bi + 1];
      bg[2] = c[bi + 2];
      surf.setCell(x0 + x, y0 + cy, '▀', fg, bg, 0);
    }
  }
}

// Shape-matched glyph mode → cells. Mirrors toShapeGlyph: sample each cell's
// region to a GW×GH luminance grid + average color, optionally enhance contrast,
// match a glyph, and (hybrid) fall back to a ramp glyph for shadowed cells. The
// cell background is black (the scene's backdrop), matching the string path.
export function shapeGlyphToSurface(
  surf: Surface,
  target: RenderTarget,
  cols: number,
  rows: number,
  options: ShapeGlyphOptions = {},
  x0 = 0,
  y0 = 0,
): void {
  const { color = true, contrast = 2, jitterTemp = 0, hybrid = false } = options;
  const rampMax = LUMINANCE_RAMP.length - 1;
  const W = target.width;
  const H = target.height;
  const c = target.color;
  const fw = W / cols;
  const fh = H / rows;
  const dim = GW * GH;
  const sum = new Array(dim);
  const cnt = new Array(dim);
  const vec = new Array(dim);
  const fg: RGB = [0, 0, 0];

  for (let cy = 0; cy < rows; cy++) {
    const yy0 = Math.floor(cy * fh);
    const yy1 = Math.max(yy0 + 1, Math.floor((cy + 1) * fh));
    for (let cx = 0; cx < cols; cx++) {
      const x1a = Math.floor(cx * fw);
      const x1b = Math.max(x1a + 1, Math.floor((cx + 1) * fw));
      const rw = x1b - x1a;
      const rh = yy1 - yy0;
      sum.fill(0);
      cnt.fill(0);
      let cr = 0;
      let cg = 0;
      let cb = 0;
      let cc = 0;
      for (let y = yy0; y < yy1; y++) {
        const gy = Math.min(GH - 1, Math.floor(((y - yy0) * GH) / rh));
        for (let x = x1a; x < x1b; x++) {
          const i = (y * W + x) * 3;
          const r = c[i];
          const g = c[i + 1];
          const b = c[i + 2];
          const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
          const gx = Math.min(GW - 1, Math.floor(((x - x1a) * GW) / rw));
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
      if (mx > 0 && contrast !== 1) {
        for (let i = 0; i < dim; i++) vec[i] = Math.pow(vec[i] / mx, contrast) * mx;
      }
      let ch = matchGlyph(vec, mx > JITTER_MIN_BRIGHTNESS ? jitterTemp : 0);
      if (ch === ' ' && hybrid && cc > 0) {
        const lum = (0.299 * cr + 0.587 * cg + 0.114 * cb) / cc / 255;
        ch = LUMINANCE_RAMP[Math.min(rampMax, Math.max(0, Math.round(lum * rampMax)))];
      }
      if (ch === ' ' || !color || cc === 0) {
        surf.setCell(x0 + cx, y0 + cy, ' ', BLACK, BLACK, 0);
      } else {
        fg[0] = cr / cc;
        fg[1] = cg / cc;
        fg[2] = cb / cc;
        surf.setCell(x0 + cx, y0 + cy, ch, fg, BLACK, 0);
      }
    }
  }
}

// Sparse shape-matched scene layer. It mirrors shapeGlyphToSurface, but only finite-depth
// pixels contribute to the glyph silhouette and color. Empty cells are skipped rather than
// painted black, allowing a foreground 3D pass to sit between ordinary TUI and portal chrome.
export function shapeGlyphLayerToSurface(
  surf: Surface,
  target: RenderTarget,
  cols: number,
  rows: number,
  options: ShapeGlyphOptions = {},
  x0 = 0,
  y0 = 0,
): void {
  const { color = true, contrast = 2, jitterTemp = 0, hybrid = false } = options;
  const rampMax = LUMINANCE_RAMP.length - 1;
  const W = target.width;
  const H = target.height;
  const c = target.color;
  const depth = target.depth;
  const bounds = finiteDepthBounds(target);
  if (!bounds) return;
  const fw = W / cols;
  const fh = H / rows;
  const dim = GW * GH;
  const sum = new Array(dim);
  const cnt = new Array(dim);
  const vec = new Array(dim);
  const fg: RGB = [0, 0, 0];

  const firstCol = Math.max(0, Math.floor(bounds.minX / fw));
  const lastCol = Math.min(cols - 1, Math.floor(bounds.maxX / fw));
  const firstRow = Math.max(0, Math.floor(bounds.minY / fh));
  const lastRow = Math.min(rows - 1, Math.floor(bounds.maxY / fh));
  for (let cy = firstRow; cy <= lastRow; cy++) {
    const yy0 = Math.floor(cy * fh);
    const yy1 = Math.max(yy0 + 1, Math.floor((cy + 1) * fh));
    for (let cx = firstCol; cx <= lastCol; cx++) {
      const x1a = Math.floor(cx * fw);
      const x1b = Math.max(x1a + 1, Math.floor((cx + 1) * fw));
      const rw = x1b - x1a;
      const rh = yy1 - yy0;
      sum.fill(0);
      cnt.fill(0);
      let cr = 0;
      let cg = 0;
      let cb = 0;
      let cc = 0;
      for (let y = yy0; y < yy1; y++) {
        const gy = Math.min(GH - 1, Math.floor(((y - yy0) * GH) / rh));
        for (let x = x1a; x < x1b; x++) {
          const pi = y * W + x;
          const gx = Math.min(GW - 1, Math.floor(((x - x1a) * GW) / rw));
          const idx = gy * GW + gx;
          // Count every subpixel so uncovered samples remain zero and describe the silhouette.
          cnt[idx]++;
          if (!Number.isFinite(depth[pi])) continue;
          const i = pi * 3;
          const r = c[i];
          const g = c[i + 1];
          const b = c[i + 2];
          sum[idx] += (0.299 * r + 0.587 * g + 0.114 * b) / 255;
          cr += r;
          cg += g;
          cb += b;
          cc++;
        }
      }
      if (cc === 0) continue;
      let mx = 0;
      for (let i = 0; i < dim; i++) {
        vec[i] = cnt[i] ? sum[i] / cnt[i] : 0;
        if (vec[i] > mx) mx = vec[i];
      }
      if (mx > 0 && contrast !== 1) {
        for (let i = 0; i < dim; i++) vec[i] = Math.pow(vec[i] / mx, contrast) * mx;
      }
      let ch = matchGlyph(vec, mx > JITTER_MIN_BRIGHTNESS ? jitterTemp : 0);
      if (ch === ' ' && hybrid) {
        const lum = (0.299 * cr + 0.587 * cg + 0.114 * cb) / cc / 255;
        ch = LUMINANCE_RAMP[Math.min(rampMax, Math.max(0, Math.round(lum * rampMax)))];
      }
      if (ch === ' ' || !color) continue;
      fg[0] = cr / cc;
      fg[1] = cg / cc;
      fg[2] = cb / cc;
      const bg = surf.getCell(x0 + cx, y0 + cy)?.bg ?? BLACK;
      surf.setCell(x0 + cx, y0 + cy, ch, fg, bg, 0);
    }
  }
}

// Luminance ramp mode → cells. Mirrors toLuminance.
export function luminanceToSurface(
  surf: Surface,
  target: RenderTarget,
  cols: number,
  rows: number,
  options: LuminanceOptions = {},
  x0 = 0,
  y0 = 0,
): void {
  const { color = true, ramp = LUMINANCE_RAMP } = options;
  const W = target.width;
  const H = target.height;
  const c = target.color;
  const fw = W / cols;
  const fh = H / rows;
  const maxIdx = ramp.length - 1;
  const fg: RGB = [0, 0, 0];

  for (let cy = 0; cy < rows; cy++) {
    const yy0 = Math.floor(cy * fh);
    const yy1 = Math.max(yy0 + 1, Math.floor((cy + 1) * fh));
    for (let cx = 0; cx < cols; cx++) {
      const x1a = Math.floor(cx * fw);
      const x1b = Math.max(x1a + 1, Math.floor((cx + 1) * fw));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let y = yy0; y < yy1; y++) {
        for (let x = x1a; x < x1b; x++) {
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
      const ch = ramp[Math.min(maxIdx, Math.max(0, Math.round(lum * maxIdx)))];
      if (ch === ' ' || !color) {
        surf.setCell(x0 + cx, y0 + cy, ' ', BLACK, BLACK, 0);
      } else {
        fg[0] = r;
        fg[1] = g;
        fg[2] = b;
        surf.setCell(x0 + cx, y0 + cy, ch, fg, BLACK, 0);
      }
    }
  }
}
