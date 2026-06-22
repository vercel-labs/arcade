import type { RenderTarget } from './framebuffer.ts';

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

// Glyph mode: one character per cell drawn from a dark→light ramp, so the
// character's ink density encodes brightness — the "ASCII art" look. Optionally
// tinted with the cell's truecolor (color: true) or left monochrome like zero's
// AsciiTerminal (color: false). With `edges`, a Sobel pass over the cell
// luminance overrides high-gradient cells with directional line glyphs
// (| / - \), so silhouettes read as drawn strokes rather than ramp fill — the
// structure-over-brightness idea that makes ASCII look sharp. Averages the two
// stacked pixels into one sample (half the vertical resolution of toHalfBlock).
export interface GlyphOptions {
  ramp?: string;
  color?: boolean;
  skipTopRows?: number;
  edges?: boolean;
  edgeThreshold?: number; // Sobel magnitude (luminance 0..1) above which a cell becomes an edge
}

const DEFAULT_RAMP = ' .:-=+*#%@';
// Terminal cells are ~twice as tall as wide; scale the vertical gradient so the
// directional glyph matches the *visual* edge angle, not the numeric one.
const EDGE_ASPECT = 0.5;

export function toGlyph(target: RenderTarget, options: GlyphOptions = {}): string {
  const { ramp = DEFAULT_RAMP, color = true, skipTopRows = 0, edges = false, edgeThreshold = 0.7 } = options;
  const W = target.width;
  const rows = Math.floor(target.height / 2);
  const col = target.color;
  const maxIdx = ramp.length - 1;

  // Pass 1: per-cell luminance (average the two stacked pixels). Needed up front
  // so the edge pass can read neighbor cells.
  const lum = new Float32Array(W * rows);
  for (let cy = 0; cy < rows; cy++) {
    const top = 2 * cy * W;
    const bot = (2 * cy + 1) * W;
    for (let x = 0; x < W; x++) {
      const ti = (top + x) * 3;
      const bi = (bot + x) * 3;
      const r = (col[ti] + col[bi]) * 0.5;
      const g = (col[ti + 1] + col[bi + 1]) * 0.5;
      const b = (col[ti + 2] + col[bi + 2]) * 0.5;
      lum[cy * W + x] = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    }
  }

  let out = '';
  let last = '';
  for (let cy = Math.max(0, skipTopRows); cy < rows; cy++) {
    out += `\x1b[${cy + 1};1H`;
    const top = 2 * cy * W;
    const bot = (2 * cy + 1) * W;
    for (let x = 0; x < W; x++) {
      const i = cy * W + x;
      let ch = ramp[Math.min(maxIdx, Math.max(0, Math.round(lum[i] * maxIdx)))];

      if (edges && cy > 0 && cy < rows - 1 && x > 0 && x < W - 1) {
        const tl = lum[i - W - 1];
        const tc = lum[i - W];
        const tr = lum[i - W + 1];
        const ml = lum[i - 1];
        const mr = lum[i + 1];
        const bl = lum[i + W - 1];
        const bc = lum[i + W];
        const br = lum[i + W + 1];
        const gx = tr + 2 * mr + br - (tl + 2 * ml + bl);
        const gy = bl + 2 * bc + br - (tl + 2 * tc + tr);
        if (Math.hypot(gx, gy) > edgeThreshold) ch = edgeGlyph(gx, gy);
      }

      if (ch === ' ') {
        out += ' ';
        continue;
      }
      if (color) {
        const ti = (top + x) * 3;
        const bi = (bot + x) * 3;
        const r = (col[ti] + col[bi]) * 0.5;
        const g = (col[ti + 1] + col[bi + 1]) * 0.5;
        const b = (col[ti + 2] + col[bi + 2]) * 0.5;
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

// Maps a luminance gradient to the line glyph that lies along the edge
// (perpendicular to the gradient), aspect-corrected for tall terminal cells.
function edgeGlyph(gx: number, gy: number): string {
  const deg = ((Math.atan2(gy * EDGE_ASPECT, gx) * 180) / Math.PI + 180) % 180;
  if (deg < 22.5 || deg >= 157.5) return '|';
  if (deg < 67.5) return '/';
  if (deg < 112.5) return '-';
  return '\\';
}

function byte(v: number): number {
  if (v <= 0) return 0;
  if (v >= 255) return 255;
  return Math.round(v);
}
