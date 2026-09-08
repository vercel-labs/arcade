import assert from 'node:assert/strict';
import test from 'node:test';
import { CINEMATIC_CELL_HEIGHT, MOBILE_CINEMATIC_CELL_HEIGHT, responsiveTerminalGrid } from './responsive-grid.ts';

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

test('a phone viewport gets the denser mobile cell without being asked', () => {
  const phone = responsiveTerminalGrid(390, 844);
  // The ≤760px tier picks MOBILE_CINEMATIC_CELL_HEIGHT itself, so passing it
  // explicitly is now a no-op rather than an opt-in upgrade.
  assert.deepEqual(phone, responsiveTerminalGrid(390, 844, MOBILE_CINEMATIC_CELL_HEIGHT));
  assert.deepEqual(phone, { cols: 78, rows: 84 });
  // Still the density win the mobile tier exists for, measured against the 12px
  // laptop cell the phone would otherwise have used.
  const atLaptopCell = responsiveTerminalGrid(390, 844, CINEMATIC_CELL_HEIGHT);
  assert.deepEqual(atLaptopCell, { cols: 65, rows: 70 });
  assert.ok(phone.cols * phone.rows > atLaptopCell.cols * atLaptopCell.rows * 1.4);
  assert.equal(phone.cols / (phone.rows * 2), 78 / 168);
});

test('large monitors increase cinematic cell size without affecting laptop or shallow-wide grids', () => {
  const monitor = responsiveTerminalGrid(2558, 1289);
  const oldDensity = responsiveTerminalGrid(2558, 1289, 12);
  assert.deepEqual(monitor, { cols: 284, rows: 71 });
  assert.deepEqual(oldDensity, { cols: 426, rows: 107 });
  assert.ok(monitor.cols * monitor.rows < oldDensity.cols * oldDensity.rows * 0.5, 'large screens should render at least 50% fewer cells');
  assert.deepEqual(responsiveTerminalGrid(1799, 899), { cols: 299, rows: 74 });
  assert.deepEqual(responsiveTerminalGrid(1800, 656), { cols: 300, rows: 54 }, 'a shallow ultrawide retains laptop-sized cells');
});
