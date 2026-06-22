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

function byte(v: number): number {
  if (v <= 0) return 0;
  if (v >= 255) return 255;
  return Math.round(v);
}
