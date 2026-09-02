import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RenderTarget } from '../../engine/index.ts';
import { drawIslandersDiceOverlay } from './dice-overlay.ts';
import { cinematicDiceState, type Die } from './dice-choreography.ts';

const dice: [Die, Die] = [
  { val: 4, spinX: 2, spinZ: 2, yaw: 0, yawSpin: 2, jx: 0, jz: 0, wob: 0.2, dur: 1 },
  { val: 5, spinX: 2, spinZ: 2, yaw: 0, yawSpin: 2, jx: 0, jz: 0, wob: 0.2, dur: 1 },
];

test('full-frame dice overlay preserves scene depth outside its screen-space box', () => {
  const target = seededTarget();
  drawIslandersDiceOverlay(target, dice, 1, true, { preserveSceneDepth: true });
  assert.ok(target.depth.every(Number.isFinite), 'the island depth mask must remain full-frame');
});

test('CLI foreground dice mode retains its sparse depth mask', () => {
  const target = seededTarget();
  drawIslandersDiceOverlay(target, dice, 1, true);
  assert.ok(target.depth.some((depth) => !Number.isFinite(depth)), 'CLI extracts dice through a sparse foreground mask');
  assert.ok(target.depth.some(Number.isFinite), 'dice themselves remain present');
});

test('CLI burn phase keeps only surviving dice in its sparse foreground mask', () => {
  const target = seededTarget();
  drawIslandersDiceOverlay(target, dice, 3.25, false, { burnProgress: 0.5 });
  const finite = target.depth.filter(Number.isFinite).length;
  assert.ok(finite > 0, 'mid-burn dice should remain visible');
  assert.ok(finite < target.depth.length * 0.2, `board depth leaked into the CLI foreground mask: ${finite}`);
});

test('shared dice timeline holds the result before a progressive ink burn', () => {
  assert.deepEqual(cinematicDiceState(0.62), { visible: true, elapsed: 3.25, rolling: false, burn: 0 });
  const burning = cinematicDiceState(0.69);
  assert.equal(burning.visible, true);
  assert.ok(burning.burn > 0 && burning.burn < 1);
  assert.equal(cinematicDiceState(0.72).visible, false);
});

test('shared dice overlay erodes through a cold silver edge before disappearing', () => {
  const counts: number[] = [];
  let silver = 0;
  for (const burnProgress of [0, 0.5, 0.9, 1]) {
    const target = new RenderTarget(240, 144);
    target.clear();
    drawIslandersDiceOverlay(target, dice, 3.25, false, { burnProgress });
    let count = 0;
    for (let pixel = 0; pixel < target.depth.length; pixel++) {
      if (!Number.isFinite(target.depth[pixel])) continue;
      count++;
      const i = pixel * 3;
      const channels = [target.color[i], target.color[i + 1], target.color[i + 2]];
      if (burnProgress === 0.5 && Math.min(...channels) > 160 && Math.max(...channels) - Math.min(...channels) < 24) silver++;
    }
    counts.push(count);
  }
  assert.ok(counts[0] > counts[1] && counts[1] > counts[2], `dice burn should erode progressively: ${counts}`);
  assert.equal(counts[3], 0);
  assert.ok(silver > 0, 'dice burn should retain the shared silver edge');
});

function seededTarget(): RenderTarget {
  const target = new RenderTarget(160, 96);
  target.clear(20, 60, 40);
  target.depth.fill(0.9);
  return target;
}
