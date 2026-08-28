import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BrowserArcade } from './browser-chess.ts';

test('browser arcade opens a real chess game and applies legal moves', () => {
  const arcade = new BrowserArcade();
  assert.equal(arcade.frame().screen, 'launcher');

  assert.equal(arcade.play('e4'), true);
  const frame = arcade.frame();
  assert.equal(frame.screen, 'chess');
  assert.match(frame.status, /black to move/);
  let boardGlyphs = 0;
  for (let y = 3; y < frame.surface.rows - 4; y++) {
    for (let x = 0; x < frame.surface.cols; x++) {
      if (frame.surface.getCell(x, y)?.ch !== ' ') boardGlyphs++;
    }
  }
  assert.ok(boardGlyphs > 100, 'the browser board should remain legible in ASCII mode');
  assert.equal(arcade.play('e5'), true);
  assert.equal(arcade.play('e9'), false, 'an invalid coordinate is rejected');
});

test('browser arcade cycles the same three presentation modes as the terminal', () => {
  const arcade = new BrowserArcade();
  assert.equal(arcade.frame().displayMode, 'ascii');
  assert.equal(arcade.cycleDisplayMode(), 'pixel');
  assert.equal(arcade.cycleDisplayMode(), 'hybrid');
  assert.equal(arcade.cycleDisplayMode(), 'ascii');
});

test('reset restores the initial chess position without leaving the game', () => {
  const arcade = new BrowserArcade();
  arcade.play('e4');
  arcade.reset();
  const frame = arcade.frame();
  assert.equal(frame.screen, 'chess');
  assert.match(frame.status, /white to move/);
});
