import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pinchWheelSteps, sgrMouse, terminalCell } from './terminal-touch.ts';

test('touch coordinates map into one-based clamped terminal cells', () => {
  const grid = { left: 10, top: 20, width: 360, height: 640, cols: 60, rows: 40 };
  assert.deepEqual(terminalCell(10, 20, grid), { x: 1, y: 1 });
  assert.deepEqual(terminalCell(370, 660, grid), { x: 60, y: 40 });
  assert.deepEqual(terminalCell(190, 340, grid), { x: 31, y: 21 });
});

test('mobile gestures emit the desktop SGR mouse protocol', () => {
  assert.equal(sgrMouse('left-down', 4, 5), '\x1b[<0;4;5M');
  assert.equal(sgrMouse('left-drag', 6, 7), '\x1b[<32;6;7M');
  assert.equal(sgrMouse('left-up', 6, 7), '\x1b[<0;6;7m');
  assert.equal(sgrMouse('right-down', 8, 9), '\x1b[<2;8;9M');
  assert.equal(sgrMouse('right-up', 8, 9), '\x1b[<2;8;9m');
  assert.equal(sgrMouse('wheel-up', 2, 3), '\x1b[<64;2;3M');
  assert.equal(sgrMouse('wheel-down', 2, 3), '\x1b[<65;2;3M');
});

test('pinch apart zooms inward and pinch together zooms outward', () => {
  assert.equal(pinchWheelSteps(100, 140), 2);
  assert.equal(pinchWheelSteps(140, 100), -2);
  assert.equal(pinchWheelSteps(100, 110), 0);
});
