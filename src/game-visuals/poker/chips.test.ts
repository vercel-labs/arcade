import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHIP_COLLISION_DISTANCE,
  arrangeChipColumns,
  chipAmount,
  chipColumnPlacements,
  chipPileHalfExtent,
  playerColumns,
  takeChipColumns,
  type ChipColumn,
} from './chips.ts';

test('identical stacks get stable but distinct denomination layouts per seat', () => {
  const columns = playerColumns(1_000);
  const layouts = [0, 1, 2, 3].map((seed) => arrangeChipColumns(columns, seed));
  assert.deepEqual(layouts[0], arrangeChipColumns(columns, 0), 'a seat layout must not shimmer');
  assert.equal(new Set(layouts.map((layout) => layout.map((column) => column.value).join(','))).size, 4);
  for (const layout of layouts) {
    assert.deepEqual(
      layout.map(({ value, count }) => ({ value, count })).sort((a, b) => b.value - a.value || b.count - a.count),
      columns.map(({ value, count }) => ({ value, count })).sort((a, b) => b.value - a.value || b.count - a.count),
      'layout variation must not change tower values or heights',
    );
  }
});

test('chip column placement is stable for a given pile and seed', () => {
  assert.deepEqual(chipColumnPlacements(12, 37), chipColumnPlacements(12, 37));
  assert.notDeepEqual(chipColumnPlacements(12, 37), chipColumnPlacements(12, 38));
});

test('neighboring chip columns never overlap', () => {
  for (let count = 2; count <= 40; count++) {
    for (let seed = 0; seed < 50; seed++) {
      const placements = chipColumnPlacements(count, seed);
      for (let i = 0; i < placements.length; i++) {
        for (let j = i + 1; j < placements.length; j++) {
          const distance = Math.hypot(
            placements[i].axis - placements[j].axis,
            placements[i].perp - placements[j].perp,
          );
          assert.ok(
            distance >= CHIP_COLLISION_DISTANCE - 1e-8,
            `columns ${i} and ${j} overlap for count ${count}, seed ${seed}`,
          );
        }
      }
    }
  }
});

test('reported pile bounds contain every resolved chip footprint', () => {
  const columns: ChipColumn[] = Array.from({ length: 24 }, () => ({ value: 10, count: 1 }));
  for (let seed = 0; seed < 50; seed++) {
    const placements = chipColumnPlacements(columns.length, seed);
    const extent = chipPileHalfExtent(columns, seed);
    const radius = CHIP_COLLISION_DISTANCE / 2;
    for (const placement of placements) {
      assert.ok(Math.abs(placement.axis) + radius <= extent.axis + 1e-12);
      assert.ok(Math.abs(placement.perp) + radius <= extent.perp + 1e-12);
    }
  }
});

test('large player stacks use higher denominations and at most two towers per color', () => {
  const columns = playerColumns(10_000);
  assert.equal(chipAmount(columns), 10_000);
  assert.ok(columns.some((column) => column.value === 500), 'large stacks should contain black $500 chips');
  for (const value of new Set(columns.map((column) => column.value))) {
    assert.ok(columns.filter((column) => column.value === value).length <= 2);
  }
  assert.ok(Math.max(...columns.map((column) => column.count)) >= 8, 'height is preferred over fanning out');
});

test('an all-in pushes the exact owned chip towers without recoloring them', () => {
  const stack = playerColumns(10_000);
  const moved = takeChipColumns(stack, chipAmount(stack), true);
  assert.deepEqual(moved.remaining, []);
  assert.deepEqual(moved.pushed, stack);
  assert.equal(moved.converted, false);
});

test('ordinary bets use owned denominations when exact change exists', () => {
  const stack = playerColumns(1_000);
  const moved = takeChipColumns(stack, 140);
  assert.equal(chipAmount(moved.pushed), 140);
  assert.equal(chipAmount(moved.remaining), 860);
  assert.equal(moved.converted, false);
});

test('ordinary bets make change only when the current inventory cannot pay exactly', () => {
  const stack: ChipColumn[] = [{ value: 500, count: 1 }];
  const moved = takeChipColumns(stack, 100);
  assert.equal(chipAmount(moved.pushed), 100);
  assert.equal(chipAmount(moved.remaining), 400);
  assert.equal(moved.converted, true);
});

test('split-pot remainders remain exact visual chip values', () => {
  for (const amount of [1, 5, 995, 1_003]) {
    assert.equal(chipAmount(playerColumns(amount)), amount);
  }
});
