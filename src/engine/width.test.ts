// Cell-width measurement: the wcwidth-style table that layout, centering, and
// hit-testing depend on. In particular, the misc-symbols block (U+2600–27BF) is
// mostly emoji (wide), but a few sub-ranges render text-presentation single-cell in
// terminals and are special-cased — chess pieces, check/cross dingbats, and the card
// suit pips used by the poker hand panel. A wide mis-measurement there desyncs the
// surface from the terminal and leaves stale-cell remnants.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cellWidth, stringWidth } from './width.ts';

test('card suit pips are single-cell', () => {
  for (const s of ['♠', '♡', '♢', '♣', '♤', '♥', '♦', '♧']) {
    assert.equal(cellWidth(s.codePointAt(0)!), 1, `${s} should be 1 cell`);
  }
  // A revealed card in the poker panel ("rank + suit") is exactly two cells.
  assert.equal(stringWidth('T♥'), 2);
  assert.equal(stringWidth('A♣'), 2);
});

test('other special-cased single-cell glyphs stay narrow', () => {
  assert.equal(cellWidth('♞'.codePointAt(0)!), 1); // chess knight (U+265E)
  assert.equal(cellWidth('✕'.codePointAt(0)!), 1); // close cross (U+2715)
  assert.equal(cellWidth('•'.codePointAt(0)!), 1); // Catan production pip (U+2022)
});

test('genuinely wide + zero-width codepoints are unchanged', () => {
  assert.equal(cellWidth('世'.codePointAt(0)!), 2); // CJK
  assert.equal(cellWidth('💬'.codePointAt(0)!), 2); // emoji
  assert.equal(cellWidth('a'.codePointAt(0)!), 1);
  assert.equal(cellWidth(0x0301), 0); // combining acute accent
});
