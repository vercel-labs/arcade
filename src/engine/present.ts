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
// with the cell's average color. `contrast` applies Alex's global contrast
// enhancement to the cell vector (normalize → pow → denormalize) to sharpen.
export interface ShapeGlyphOptions {
  color?: boolean;
  skipTopRows?: number;
  contrast?: number;
  // > 0 enables softmax sampling among the nearest glyphs (subtle variation);
  // 0 is deterministic nearest match.
  jitterTemp?: number;
  // When the shape match resolves to a blank but the cell still has brightness
  // (e.g. a shadowed surface), fall back to a faint luminance-ramp glyph so the
  // form stays visible instead of dropping out.
  hybrid?: boolean;
  // Paint each emitted glyph over a darker version of its average scene color.
  // Blank glyph cells remain black, so this adds color blocks without filling
  // the untouched backdrop.
  coloredBackground?: boolean;
}

// Cells dimmer than this are matched deterministically even when jitter is on.
const JITTER_MIN_BRIGHTNESS = 0.25;
export const SHAPE_GLYPH_BACKGROUND_SCALE = 0.28;

export function toShapeGlyph(
  target: RenderTarget,
  cols: number,
  rows: number,
  options: ShapeGlyphOptions = {},
): string {
  const { color = true, skipTopRows = 0, contrast = 2, jitterTemp = 0, hybrid = false, coloredBackground = false } = options;
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
      if (mx > 0 && contrast !== 1) {
        for (let i = 0; i < dim; i++) vec[i] = Math.pow(vec[i] / mx, contrast) * mx;
      }

      // Only jitter cells with real brightness — near-black background cells have
      // near-identical candidates (space/./,) and would just flicker as noise.
      let ch = matchGlyph(vec, mx > JITTER_MIN_BRIGHTNESS ? jitterTemp : 0);
      if (ch === ' ' && hybrid && cc > 0) {
        // Shape match gave up on this cell — substitute a faint ramp glyph keyed
        // to its average brightness so shadowed surfaces don't drop to blanks.
        const lum = (0.299 * cr + 0.587 * cg + 0.114 * cb) / cc / 255;
        ch = LUMINANCE_RAMP[Math.min(rampMax, Math.max(0, Math.round(lum * rampMax)))];
      }
      if (ch === ' ') {
        if (coloredBackground) {
          const seq = '\x1b[48;2;0;0;0m';
          if (seq !== last) {
            out += seq;
            last = seq;
          }
        }
        out += ' ';
        continue;
      }
      if (color && cc > 0) {
        const fr = cr / cc;
        const fg = cg / cc;
        const fb = cb / cc;
        const seq = coloredBackground
          ? `\x1b[38;2;${byte(fr)};${byte(fg)};${byte(fb)};48;2;${byte(fr * SHAPE_GLYPH_BACKGROUND_SCALE)};${byte(fg * SHAPE_GLYPH_BACKGROUND_SCALE)};${byte(fb * SHAPE_GLYPH_BACKGROUND_SCALE)}m`
          : `\x1b[38;2;${byte(fr)};${byte(fg)};${byte(fb)}m`;
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
}

const LUMINANCE_RAMP = ' .:coP0?@█';

export function toLuminance(
  target: RenderTarget,
  cols: number,
  rows: number,
  options: LuminanceOptions = {},
): string {
  const { color = true, skipTopRows = 0, ramp = LUMINANCE_RAMP } = options;
  const W = target.width;
  const H = target.height;
  const c = target.color;
  const fw = W / cols;
  const fh = H / rows;
  const maxIdx = ramp.length - 1;
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
      const ch = ramp[Math.min(maxIdx, Math.max(0, Math.round(lum * maxIdx)))];
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

function byte(v: number): number {
  if (v <= 0) return 0;
  if (v >= 255) return 255;
  return Math.round(v);
}
