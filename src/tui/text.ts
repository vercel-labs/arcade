// Width-aware text measurement for the UI layer: ellipsis truncation and greedy
// word wrapping.
//
// Four call sites had each grown their own copy of this (the dropdown and select
// lists, the chess chat, the Catan history row), and three of them measured with
// `.length` — which counts a wide glyph or an emoji as a single cell and so broke
// the line a column or two late.
//
// Everything here measures by CODEPOINT through engine's stringWidth, the same way
// Surface.drawText advances across the row. A break computed here therefore lands
// exactly where the renderer puts it. Grapheme clusters are deliberately not
// treated as units: the renderer doesn't treat them that way either, and
// disagreeing with it would reintroduce the off-by-a-cell that measuring by width
// exists to remove.

import { stringWidth } from '../engine/index.ts';

const ELLIPSIS = '…';

// The longest prefix of `s` that fits in `max` cells, with the width it used.
function head(s: string, max: number): { text: string; width: number } {
  let out = '';
  let w = 0;
  for (const ch of s) {
    const cw = stringWidth(ch);
    if (w + cw > max) break;
    out += ch;
    w += cw;
  }
  return { text: out, width: w };
}

// `s` clipped to at most `max` cells, gaining a trailing ellipsis when anything
// was cut. The ellipsis is paid for out of the budget, so the result never
// exceeds `max` — the point of truncating is to fit.
export function truncate(s: string, max: number): string {
  if (max <= 0) return '';
  if (stringWidth(s) <= max) return s;
  const room = max - stringWidth(ELLIPSIS);
  if (room <= 0) return ELLIPSIS;
  return head(s, room).text + ELLIPSIS;
}

// `s` cut to at most `max` cells with nothing appended — the hard clip. Cuts on a
// glyph boundary, so a wide glyph that would straddle the edge is dropped whole
// rather than leaving the renderer half a character to draw.
export function clipText(s: string, max: number): string {
  if (max <= 0) return '';
  if (stringWidth(s) <= max) return s;
  return head(s, max).text;
}

export interface WrapOpts {
  // Cells available on the FIRST line when it differs from the others — a chat
  // row whose speaker name already occupies part of row one.
  first?: number;
}

// Greedy word wrap to `width` cells. Runs of whitespace collapse into one break
// opportunity, and a word too long for a line is hard-split across rows. Always
// returns at least one entry so an empty string still occupies a row.
export function wrapText(s: string, width: number, opts: WrapOpts = {}): string[] {
  if (width <= 0) return [s];
  const firstW = Math.max(1, opts.first ?? width);
  const out: string[] = [];
  let line = '';
  let lineW = 0;
  const cap = (): number => (out.length === 0 ? firstW : width);
  const flush = (): void => {
    out.push(line);
    line = '';
    lineW = 0;
  };

  for (const word of s.split(/\s+/)) {
    if (!word) continue;
    let w = word;
    let ww = stringWidth(w);
    while (ww > cap()) {
      // Finish whatever is already on this row before splitting the word.
      if (lineW > 0) {
        flush();
        continue;
      }
      // Only the FIRST row is short (a long speaker name ate it) and the word
      // would fit on a continuation: drop it down whole rather than emit a
      // fragment like "Gem" / "ini,".
      if (out.length === 0 && firstW < width && ww <= width) {
        out.push('');
        continue;
      }
      const piece = head(w, cap());
      // A single glyph wider than the whole row gets its own row; taking nothing
      // here would never shrink `w`.
      const taken = piece.text || ([...w][0] ?? '');
      out.push(taken);
      w = w.slice(taken.length);
      ww = stringWidth(w);
    }
    if (!w) continue; // the hard split above consumed the whole word
    if (lineW === 0) {
      line = w;
      lineW = ww;
    } else if (lineW + 1 + ww <= cap()) {
      line += ` ${w}`;
      lineW += 1 + ww;
    } else {
      flush();
      line = w;
      lineW = ww;
    }
  }
  // Emit the partial last row, but never a trailing blank one — except when
  // there is nothing else at all, since callers count on one row per string.
  if (line || out.length === 0) out.push(line);
  return out;
}
