import assert from 'node:assert/strict';
import test from 'node:test';
import { MOBILE_CINEMATIC_CELL_HEIGHT, responsiveTerminalGrid } from './responsive-grid.ts';

test('resizing changes terminal dimensions without changing cell size or camera aspect', () => {
  const laptop = responsiveTerminalGrid(1265, 656);
  const wide = responsiveTerminalGrid(1800, 656);
  const tall = responsiveTerminalGrid(1265, 900);

  assert.deepEqual(laptop, { cols: 210, rows: 54 });
  assert.deepEqual(wide, { cols: 300, rows: 54 });
  assert.deepEqual(tall, { cols: 210, rows: 75 });
  for (const [width, height, grid] of [[1265, 656, laptop], [1800, 656, wide], [1265, 900, tall]] as const) {
    assert.ok(width - grid.cols * 6 >= 0 && width - grid.cols * 6 < 6, 'less than one cell of horizontal remainder');
    assert.ok(height - grid.rows * 12 >= 0 && height - grid.rows * 12 < 12, 'less than one cell of vertical remainder');
  }
});

test('mobile cinematic cells increase ASCII sampling density without changing geometry', () => {
  const desktopDensity = responsiveTerminalGrid(390, 844);
  const mobileDensity = responsiveTerminalGrid(390, 844, MOBILE_CINEMATIC_CELL_HEIGHT);
  assert.deepEqual(desktopDensity, { cols: 65, rows: 70 });
  assert.deepEqual(mobileDensity, { cols: 78, rows: 84 });
  assert.ok(mobileDensity.cols * mobileDensity.rows > desktopDensity.cols * desktopDensity.rows * 1.4);
  assert.equal(mobileDensity.cols / (mobileDensity.rows * 2), 78 / 168);
});
