import assert from 'node:assert/strict';
import test from 'node:test';
import { applyTerminalColorMode, rgbToAnsi256 } from './terminal-color.ts';

test('rgbToAnsi256 maps saturated and grayscale colors into xterm-256', () => {
  assert.equal(rgbToAnsi256(255, 0, 0), 196);
  assert.equal(rgbToAnsi256(0, 0, 0), 16);
  assert.equal(rgbToAnsi256(255, 255, 255), 231);
});

test('rgbToAnsi256 keeps dark chrome and warm ivory on the grayscale ramp', () => {
  // These are Arcade's menu/modal background and light chess-square colors.
  assert.equal(rgbToAnsi256(22, 24, 32), 234);
  assert.equal(rgbToAnsi256(28, 30, 40), 234);
  assert.equal(rgbToAnsi256(232, 228, 216), 254);
});

test('rgbToAnsi256 preserves intentional poker hues', () => {
  assert.equal(rgbToAnsi256(12, 46, 28), 22); // felt green
  assert.equal(rgbToAnsi256(132, 88, 52), 130); // wood brown
  assert.equal(rgbToAnsi256(96, 44, 44), 88); // fold red
  assert.equal(rgbToAnsi256(86, 64, 120), 60); // raise purple
  assert.equal(rgbToAnsi256(44, 46, 56), 236); // neutral call button stays gray
});

test('rgbToAnsi256 keeps muted active and scrim-dimmed colors neutral', () => {
  assert.equal(rgbToAnsi256(46, 52, 72), 236); // active-player slate
  // Representative brown surfaces after the default modal scrim is composited.
  assert.equal(rgbToAnsi256(60, 40, 24), 236);
  assert.equal(rgbToAnsi256(84, 58, 38), 238);
});

test('truecolor output is unchanged', () => {
  const output = '\x1b[38;2;255;0;0mred\x1b[0m';
  assert.equal(applyTerminalColorMode(output, 'truecolor'), output);
});

test('256-color mode converts foreground and background inside combined SGR', () => {
  const output = '\x1b[0;1;38;2;255;0;0;48;2;0;0;0mX\x1b[0m';
  assert.equal(
    applyTerminalColorMode(output, '256-color'),
    '\x1b[0;1;38;5;196;48;5;16mX\x1b[0m',
  );
});
