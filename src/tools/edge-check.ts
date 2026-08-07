// Paints a one-cell border around the whole terminal, through the same Surface + emit path the
// arcade uses, with nothing else on screen. It answers one question: can the renderer actually
// reach the outermost cells of this terminal?
//
//   pnpm exec tsx src/tools/edge-check.ts     (any key exits)
//
// Reading the result:
//
//   Solid magenta rings the whole window, flush to every edge
//     The renderer reaches the last row and column. Any leftover strip outside the ring is the
//     terminal's own MARGIN — the sliver left over when the window's pixel width is not a whole
//     number of character cells. No program can paint it; it is not a cell. platform/terminal.ts
//     forces the terminal's default background to black (OSC 11) so that sliver blends in, so a
//     visible strip means this terminal ignored OSC 11 or is compositing it (transparency, blur,
//     a background image).
//
//   The ring is inset, or breaks up along an edge
//     That is a renderer bug — capture the output and the terminal's reported size.
//
// The corner digits are the size we were told (process.stdout.columns/rows). If they disagree with
// the terminal's own idea of its size, everything downstream inherits that error.

import { Surface } from '../engine/surface.ts';
import type { RGB } from '../engine/index.ts';
import { enter, leave } from '../platform/terminal.ts';

const cols = process.stdout.columns ?? 80;
const rows = process.stdout.rows ?? 24;

const EDGE: RGB = [230, 70, 200]; // magenta — nothing in the arcade palette is close
const LAST: RGB = [90, 230, 160]; // the final column and row, so they are separable from the ring
const FIELD: RGB = [60, 62, 72];
const BLACK: RGB = [0, 0, 0];

const surf = new Surface(cols, rows);
for (let y = 0; y < rows; y++) {
  for (let x = 0; x < cols; x++) {
    const lastCol = x === cols - 1;
    const lastRow = y === rows - 1;
    const edge = x === 0 || y === 0 || lastCol || lastRow;
    if (!edge) {
      surf.setCell(x, y, '·', FIELD, BLACK);
      continue;
    }
    const color = lastCol || lastRow ? LAST : EDGE;
    surf.setCell(x, y, ' ', color, color);
  }
}

const label = `${cols} x ${rows}`;
for (let i = 0; i < label.length && i + 2 < cols; i++) {
  surf.setCell(i + 2, 2, label[i], [235, 236, 244], BLACK);
}
const hint = 'magenta = first row/col, green = LAST row/col. any key exits.';
for (let i = 0; i < hint.length && i + 2 < cols; i++) {
  surf.setCell(i + 2, 4, hint[i], [150, 154, 170], BLACK);
}

enter();
process.stdout.write(surf.serialize());
process.stdin.once('data', () => {
  leave();
  process.exit(0);
});
