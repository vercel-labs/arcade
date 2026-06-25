// Big block-letter text from the engine's 8x8 bitmap font (zero new deps). The
// 8 rows of each glyph are compressed to 4 output rows with half-blocks (█ ▀ ▄),
// which keeps banners compact and crisp — "big enough but minimal" rather than a
// chunky 8-row figlet. Stateless: this is a pure builder, not a Component.

import { FONT } from '../../engine/font8x8.ts';
import { Box, Text } from '../nodes.ts';
import type { ColorToken } from '../theme.ts';
import type { Node, Style } from '../types.ts';

const HALF = [' ', '▄', '▀', '█']; // index = (topBit << 1) | bottomBit

// Render `text` to 4 strings of half-block glyphs. Each glyph is trimmed of its
// fully-empty leading/trailing columns and joined with one blank column, so the
// result reads tight instead of fixed-8-wide-monospace.
export function asciiFontLines(text: string): string[] {
  const out = ['', '', '', ''];
  const glyphs = [...text].map((ch) => FONT[ch] ?? FONT[ch.toUpperCase()] ?? FONT[' ']);
  glyphs.forEach((g, gi) => {
    // Columns that carry any ink across the 8 rows (for trimming).
    let lo = 8;
    let hi = -1;
    for (let x = 0; x < 8; x++) {
      if (g.some((row) => row[x] === '1')) {
        lo = Math.min(lo, x);
        hi = Math.max(hi, x);
      }
    }
    if (hi < 0) {
      lo = 0;
      hi = 2;
    } // blank glyph (space) → a few columns of gap
    for (let r = 0; r < 4; r++) {
      let line = '';
      for (let x = lo; x <= hi; x++) {
        const top = g[r * 2][x] === '1' ? 1 : 0;
        const bot = g[r * 2 + 1][x] === '1' ? 1 : 0;
        line += HALF[(top << 1) | bot];
      }
      out[r] += line + (gi < glyphs.length - 1 ? ' ' : '');
    }
  });
  return out;
}

// A column of Text nodes spelling `text` in compressed block letters. Pass a
// color token (defaults to the theme fg via Text's inheritance).
export function ASCIIFont(text: string, opts: { color?: ColorToken; style?: Style } = {}): Node {
  const lineStyle: Style = { ...opts.style, ...(opts.color != null ? { color: opts.color } : {}) };
  return Box(
    { flexDirection: 'column', alignItems: 'start' },
    asciiFontLines(text).map((line) => Text({ text: line, style: lineStyle })),
  );
}
