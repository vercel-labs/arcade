// Cell-level text painting. The surface model must agree with what the terminal draws: the diff
// compares its own model against itself, so a mismatch is invisible to it and never repaired.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Surface } from './surface.ts';
import { stringWidth } from './width.ts';

test('a variation selector stays in its glyph cell instead of being dropped', () => {
  // U+FE0F is zero-width but decides whether the terminal draws an emoji or its text fallback.
  const surf = new Surface(10, 1);
  surf.drawText(0, 0, '🛡️x', [255, 255, 255], [0, 0, 0]);
  assert.equal(surf.getCell(0, 0)?.ch, '🛡️'); // base + selector travel together
  // 🛡 is Emoji_Presentation=No, so it advances one cell; the selector rides along.
  assert.equal(stringWidth('🛡️'), 1);
  assert.equal(surf.getCell(1, 0)?.ch, 'x');

  // A genuinely wide emoji keeps its two-cell reservation with the selector attached.
  const wide = new Surface(10, 1);
  wide.drawText(0, 0, '🪵x', [255, 255, 255], [0, 0, 0]);
  assert.equal(stringWidth('🪵'), 2);
  assert.equal(wide.getCell(2, 0)?.ch, 'x');
});

test('a leading zero-width codepoint cannot escape into an earlier cell', () => {
  const surf = new Surface(6, 1);
  surf.drawText(2, 0, '️a', [255, 255, 255], [0, 0, 0]);
  assert.equal(surf.getCell(1, 0)?.ch, ' '); // nothing written before the first real glyph
  assert.equal(surf.getCell(2, 0)?.ch, 'a');
});

const W: [number, number, number] = [255, 255, 255];
const K: [number, number, number] = [0, 0, 0];

test('text-presentation die faces occupy one terminal cell', () => {
  assert.equal(stringWidth('⚄ roll'), 6);
  const hovered = new Surface(8, 1);
  const fill: [number, number, number] = [44, 46, 58];
  hovered.fillRect(0, 0, 8, 1, fill);
  hovered.drawText(1, 0, '⚄ roll', W, fill);
  assert.deepEqual(
    Array.from({ length: 6 }, (_, x) => hovered.getCell(x + 1, 0)?.ch),
    ['⚄', ' ', 'r', 'o', 'l', 'l'],
  );
  assert.ok(Array.from({ length: 6 }, (_, x) => hovered.getCell(x + 1, 0)?.bg).every((bg) => bg?.join(',') === fill.join(',')));
});

test('overwriting either half of a double-width glyph blanks the other', () => {
  // A half-replaced pair cannot be rendered: the old glyph stays and new content lands on it.
  const tail = new Surface(6, 1);
  tail.drawText(0, 0, '🪵', W, K);
  tail.setCell(1, 0, 'x', W, K);
  assert.equal(tail.getCell(0, 0)?.ch, ' ', 'head blanked when its tail is taken');
  assert.equal(tail.getCell(1, 0)?.ch, 'x');

  const head = new Surface(6, 1);
  head.drawText(0, 0, '🪵', W, K);
  head.setCell(0, 0, 'x', W, K);
  assert.equal(head.getCell(1, 0)?.ch, ' ', 'tail cleared when its head goes narrow');
});

test('a diff run re-anchors the cursor after a wide glyph tail', () => {
  // The tail emits no bytes, so a run left open across it writes the next cell a column early.
  const prev = new Surface(8, 1);
  const cur = new Surface(8, 1);
  prev.drawText(0, 0, '........', W, K);
  cur.drawText(0, 0, '..', W, K);
  cur.drawText(2, 0, '🪵', W, K);
  cur.drawText(4, 0, 'ab..', W, K);
  const out = cur.diff(prev);
  const afterGlyph = out.slice(out.indexOf('🪵'));
  assert.ok(afterGlyph.includes('a'), 'the later cells are emitted');
  assert.ok(/\x1b\[\d+;\d+H/.test(afterGlyph.slice(0, afterGlyph.indexOf('a'))), 'cursor re-anchored before them');
});

test('a diff run reuses unchanged terminal color state', () => {
  const prev = new Surface(3, 1);
  const cur = new Surface(3, 1);
  cur.setCell(0, 0, 'a', [100, 110, 120], [4, 5, 6]);
  cur.setCell(1, 0, 'b', [130, 140, 150], [4, 5, 6]);
  cur.setCell(2, 0, 'c', [130, 140, 150], [7, 8, 9]);

  const out = cur.diff(prev);
  assert.equal(out.match(/48;2;4;5;6/g)?.length, 1, 'an unchanged background is not repeated');
  assert.equal(out.match(/38;2;130;140;150/g)?.length, 1, 'an unchanged foreground is not repeated');
  assert.match(out, /\x1b\[38;2;130;140;150m/);
  assert.match(out, /\x1b\[48;2;7;8;9m/);
});

test('a wide glyph is refused the final column, where the terminal would wrap it', () => {
  // Two cells of glyph and one column left. The terminal draws it anyway and advances two, so it
  // spills onto the next row's first cell — a cell the model never wrote, which makes the debris
  // invisible to the diff and permanent until something else overdraws it.
  const s = new Surface(6, 2);
  s.drawText(5, 0, '🐑', W, K);
  assert.equal(s.getCell(5, 0)?.ch, ' ', 'the glyph is dropped, not kept where it cannot fit');
  assert.equal(s.getCell(0, 1)?.ch, ' ', 'and nothing is written on the row below');
  assert.ok(!s.diff(new Surface(6, 2)).includes('🐑'), 'so it is never emitted at the edge');

  // One column further left it fits, and still occupies both of its cells.
  const ok = new Surface(6, 2);
  ok.drawText(4, 0, '🐑', W, K);
  assert.equal(ok.getCell(4, 0)?.ch, '🐑');
  assert.ok(ok.diff(new Surface(6, 2)).includes('🐑'));
});

test('setCell refuses a wide glyph in the final column however it is reached', () => {
  // drawText is not the only writer — component draw hooks call setCell directly.
  const s = new Surface(4, 1);
  s.setCell(3, 0, '🧱', W, K);
  assert.equal(s.getCell(3, 0)?.ch, ' ');
  assert.equal(stringWidth(s.getCell(3, 0)!.ch), 1, 'whatever lands there advances exactly one cell');
});
