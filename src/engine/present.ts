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
// AsciiTerminal (color: false). Averages the two stacked pixels into one sample,
// so it has half the vertical resolution of toHalfBlock — traded for texture.
export interface GlyphOptions {
  ramp?: string;
  color?: boolean;
  skipTopRows?: number;
}

const DEFAULT_RAMP = ' .:-=+*#%@';

export function toGlyph(target: RenderTarget, options: GlyphOptions = {}): string {
  const { ramp = DEFAULT_RAMP, color = true, skipTopRows = 0 } = options;
  const W = target.width;
  const rows = Math.floor(target.height / 2);
  const col = target.color;
  const maxIdx = ramp.length - 1;
  let out = '';
  let last = '';
  for (let cy = Math.max(0, skipTopRows); cy < rows; cy++) {
    out += `\x1b[${cy + 1};1H`;
    const top = 2 * cy * W;
    const bot = (2 * cy + 1) * W;
    for (let x = 0; x < W; x++) {
      const ti = (top + x) * 3;
      const bi = (bot + x) * 3;
      const r = (col[ti] + col[bi]) * 0.5;
      const g = (col[ti + 1] + col[bi + 1]) * 0.5;
      const b = (col[ti + 2] + col[bi + 2]) * 0.5;
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
