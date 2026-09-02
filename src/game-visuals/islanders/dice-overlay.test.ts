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

test('optional screen-space scale shrinks the complete dice pair', () => {
  const full = new RenderTarget(240, 144); full.clear();
  const compact = new RenderTarget(240, 144); compact.clear();
  drawIslandersDiceOverlay(full, dice, 3.25, false);
  drawIslandersDiceOverlay(compact, dice, 3.25, false, { scale: 0.78 });
  assert.ok(compact.depth.filter(Number.isFinite).length < full.depth.filter(Number.isFinite).length * 0.7);
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

test('each die burns organically instead of one being cut away before the other', () => {
  const baseline = renderedColumns(0);
  const split = baseline.findIndex((column, index) => index > 0 && column > baseline[index - 1] + 1);
  assert.ok(split > 0, 'the settled pair should render as two separate silhouettes');
  const bounds = [
    [baseline[0], baseline[split - 1]],
    [baseline[split], baseline.at(-1)!],
  ] as const;
  const full = bounds.map(([minX, maxX]) => countFinitePixels(0, minX, maxX));
  const middle = bounds.map(([minX, maxX]) => countFinitePixels(0.5, minX, maxX));
  for (let index = 0; index < 2; index++) {
    const fraction = middle[index] / full[index];
    assert.ok(fraction > 0.18 && fraction < 0.82, `die ${index} should be partially burned at the midpoint, got ${fraction}`);
  }
});

test('independent dice burn regions survive compact and wide render targets', () => {
  for (const [width, height] of [[120, 72], [240, 144], [480, 288]] as const) {
    const baseline = renderedColumns(0, width, height);
    const split = baseline.findIndex((column, index) => index > 0 && column > baseline[index - 1] + 1);
    assert.ok(split > 0, `${width}x${height} should keep two distinct dice silhouettes`);
    const bounds = [[baseline[0], baseline[split - 1]], [baseline[split], baseline.at(-1)!]] as const;
    const full = bounds.map(([minX, maxX]) => countFinitePixels(0, minX, maxX, width, height));
    const middle = bounds.map(([minX, maxX]) => countFinitePixels(0.5, minX, maxX, width, height));
    assert.ok(middle.every((count, index) => count > full[index] * 0.15 && count < full[index] * 0.85), `${width}x${height} should partially retain both dice at midpoint`);
  }
});

function renderedColumns(burnProgress: number, width = 240, height = 144): number[] {
  const target = renderBurn(burnProgress, width, height);
  return Array.from({ length: target.width }, (_, x) => x).filter((x) => {
    for (let y = 0; y < target.height; y++) if (Number.isFinite(target.depth[y * target.width + x])) return true;
    return false;
  });
}

function countFinitePixels(burnProgress: number, minX: number, maxX: number, width = 240, height = 144): number {
  const target = renderBurn(burnProgress, width, height);
  let count = 0;
  for (let y = 0; y < target.height; y++) for (let x = minX; x <= maxX; x++) if (Number.isFinite(target.depth[y * target.width + x])) count++;
  return count;
}

function renderBurn(burnProgress: number, width = 240, height = 144): RenderTarget {
  const target = new RenderTarget(width, height);
  target.clear();
  drawIslandersDiceOverlay(target, dice, 3.25, false, { burnProgress });
  return target;
}

function seededTarget(): RenderTarget {
  const target = new RenderTarget(160, 96);
  target.clear(20, 60, 40);
  target.depth.fill(0.9);
  return target;
}
