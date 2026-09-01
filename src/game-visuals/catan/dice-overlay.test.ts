import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RenderTarget } from '../../engine/index.ts';
import { drawCatanDiceOverlay } from './dice-overlay.ts';
import type { Die } from './dice-choreography.ts';

const dice: [Die, Die] = [
  { val: 4, spinX: 2, spinZ: 2, yaw: 0, yawSpin: 2, jx: 0, jz: 0, wob: 0.2, dur: 1 },
  { val: 5, spinX: 2, spinZ: 2, yaw: 0, yawSpin: 2, jx: 0, jz: 0, wob: 0.2, dur: 1 },
];

test('full-frame dice overlay preserves scene depth outside its screen-space box', () => {
  const target = seededTarget();
  drawCatanDiceOverlay(target, dice, 1, true, { preserveSceneDepth: true });
  assert.ok(target.depth.every(Number.isFinite), 'the island depth mask must remain full-frame');
});

test('CLI foreground dice mode retains its sparse depth mask', () => {
  const target = seededTarget();
  drawCatanDiceOverlay(target, dice, 1, true);
  assert.ok(target.depth.some((depth) => !Number.isFinite(depth)), 'CLI extracts dice through a sparse foreground mask');
  assert.ok(target.depth.some(Number.isFinite), 'dice themselves remain present');
});

function seededTarget(): RenderTarget {
  const target = new RenderTarget(160, 96);
  target.clear(20, 60, 40);
  target.depth.fill(0.9);
  return target;
}
