import assert from 'node:assert/strict';
import test from 'node:test';
import { stringWidth } from '../engine/index.ts';
import { truncate, wrapText } from './text.ts';

test('truncate leaves text that already fits untouched', () => {
  assert.equal(truncate('abc', 3), 'abc');
  assert.equal(truncate('abc', 9), 'abc');
  assert.equal(truncate('', 4), '');
});

test('truncate pays for the ellipsis out of the budget', () => {
  assert.equal(truncate('abcdef', 4), 'abc…');
  assert.equal(stringWidth(truncate('abcdef', 4)), 4);
  // Degenerate budgets: one cell can only hold the ellipsis, zero holds nothing.
  assert.equal(truncate('abcdef', 1), '…');
  assert.equal(truncate('abcdef', 0), '');
});

test('truncate never splits a wide glyph across the boundary', () => {
  // Each of these is two cells wide, so an odd budget must leave a cell unused
  // rather than emit half a glyph.
  const sheep = '🐑🐑🐑';
  assert.equal(stringWidth(sheep), 6);
  const cut = truncate(sheep, 4);
  assert.equal(cut, '🐑…');
  assert.ok(stringWidth(cut) <= 4);
  const tight = truncate(sheep, 3);
  assert.equal(tight, '🐑…');
});

test('truncate measures in cells, not code units', () => {
  // The bug the shared helper exists to remove: '🐑' is one JS iteration step but
  // two terminal cells, so a length-based clamp would have kept three of them.
  assert.equal(truncate('🐑🐑🐑', 5), '🐑🐑…');
});

test('wrapText breaks greedily on whitespace', () => {
  assert.deepEqual(wrapText('the quick brown fox', 10), ['the quick', 'brown fox']);
  assert.deepEqual(wrapText('a b c', 5), ['a b c']);
});

test('wrapText collapses whitespace runs and always yields a row', () => {
  assert.deepEqual(wrapText('a    b', 5), ['a b']);
  assert.deepEqual(wrapText('', 5), ['']);
  assert.deepEqual(wrapText('   ', 5), ['']);
});

test('wrapText hard-splits a word longer than the row', () => {
  assert.deepEqual(wrapText('abcdefgh', 4), ['abcd', 'efgh']);
  assert.deepEqual(wrapText('hi abcdefgh', 4), ['hi', 'abcd', 'efgh']);
});

test('wrapText degenerates safely', () => {
  assert.deepEqual(wrapText('abc', 0), ['abc']);
  // A glyph wider than the row still terminates, one row per glyph.
  assert.deepEqual(wrapText('🐑🐑', 1), ['🐑', '🐑']);
});

test('wrapText keeps every row inside the width, wide glyphs included', () => {
  const rows = wrapText('🐑 wool 🐑 wheat 🐑 ore', 8);
  for (const row of rows) assert.ok(stringWidth(row) <= 8, `"${row}" is ${stringWidth(row)} cells`);
});

test('wrapText narrows only the first row when asked', () => {
  // The chat case: a speaker name has already consumed part of row one.
  assert.deepEqual(wrapText('alpha beta', 10, { first: 5 }), ['alpha', 'beta']);
});

test('wrapText moves a whole word down rather than fragment it on a short first row', () => {
  // A long speaker name leaves 3 cells; "Gemini," fits a continuation row, so it
  // belongs there intact instead of being split into "Gem" / "ini,".
  assert.deepEqual(wrapText('Gemini, hello', 12, { first: 3 }), ['', 'Gemini,', 'hello']);
});

test('wrapText still splits a word too long for even a continuation row', () => {
  // No row can hold it, so the short first row is used rather than wasted.
  assert.deepEqual(wrapText('abcdefghij', 4, { first: 2 }), ['ab', 'cdef', 'ghij']);
});
