import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RenderTarget } from '../../engine/framebuffer.ts';
import type { Texture } from '../../engine/texture-data.ts';
import { ARCADE_CATALOGUE } from '../catalogue.ts';
import { CoverFlowRenderer, coverFlowCinematicState, coverFlowIndex } from './cover-flow.ts';

const texture: Texture = { width: 1, height: 1, data: new Uint8Array([220, 180, 120, 255]) };

test('shared Cover Flow renders carousel and launch without platform APIs', () => {
  const renderer = new CoverFlowRenderer(ARCADE_CATALOGUE, () => texture);
  const carousel = new RenderTarget(240, 216);
  renderer.renderScene(carousel, 1.25);
  assert.ok(paintedPixels(carousel) > 1_000);
  const launch = new RenderTarget(240, 216);
  renderer.renderLaunchProgress(launch, 0, 0.75);
  assert.ok(paintedPixels(launch) > 1_000);
  const cinematic = new RenderTarget(240, 216);
  renderer.renderCinematic(cinematic, 0.4, 0, 0.55);
  assert.ok(paintedPixels(cinematic) > 1_000);
});

test('production catalogue retains exact CLI and browser ordering', () => {
  assert.deepEqual(ARCADE_CATALOGUE.map(({ id }) => id), ['chess', 'poker', 'islanders', 'leaderboard', 'achievements', 'website']);
  const website = ARCADE_CATALOGUE.find((item) => item.id === 'website');
  assert.ok(website);
  assert.equal(website.externalUrl, 'https://ascii-arcade.vercel.app');
});

test('cinematic Cover Flow settles on Chess, flips, and holds before the cut', () => {
  assert.equal(coverFlowCinematicState(0.58, ARCADE_CATALOGUE.length).pos, ARCADE_CATALOGUE.length);
  assert.equal(coverFlowIndex(coverFlowCinematicState(0.58, ARCADE_CATALOGUE.length).pos, ARCADE_CATALOGUE.length), 0);
  assert.equal(coverFlowCinematicState(0.68, ARCADE_CATALOGUE.length).launch, 0);
  assert.ok(coverFlowCinematicState(0.77, ARCADE_CATALOGUE.length).launch > 0.4);
  assert.equal(coverFlowCinematicState(0.84, ARCADE_CATALOGUE.length).launch, 1);
  assert.equal(coverFlowCinematicState(0.9, ARCADE_CATALOGUE.length).launch, 1);
});

test('Cover Flow wraps virtual slots in both directions without duplicating catalogue state', () => {
  const count = ARCADE_CATALOGUE.length;
  assert.equal(coverFlowIndex(-1, count), count - 1);
  assert.equal(coverFlowIndex(0, count), 0);
  assert.equal(coverFlowIndex(count, count), 0);
  assert.equal(coverFlowIndex(count + 1, count), 1);
  assert.equal(coverFlowCinematicState(0, count).pos, 0);
  assert.equal(coverFlowCinematicState(0.58, count).pos, count);
});

test('cinematic Cover Flow accelerates, then brakes into its returning Chess cover', () => {
  const count = ARCADE_CATALOGUE.length;
  const positions = Array.from({ length: 30 }, (_, index) => coverFlowCinematicState(index * 0.58 / 29, count).pos);
  const steps = positions.slice(1).map((position, index) => position - positions[index]);
  const peak = Math.max(...steps);
  assert.ok(steps[0] < peak * 0.2, 'menu should ease away from Chess');
  assert.ok(steps.at(-1)! < peak * 0.2, 'menu should brake into Chess');
  assert.ok(steps[Math.floor(steps.length / 2)] > peak * 0.9, 'menu should move briskly through its middle');
});

test('wrapped Chess renders with the final catalogue covers immediately to its left', () => {
  const renderer = new CoverFlowRenderer(ARCADE_CATALOGUE, () => texture);
  const target = new RenderTarget(240, 216);
  renderer.renderScene(target, 0);
  assert.ok(paintedPixels(target) > 1_000);
  // Negative virtual slots must be valid screen rectangles around the centered
  // Chess slot; this is the seam the old clipped renderer omitted.
  const previous = renderer.coverScreenRect(-1, 80, 36);
  assert.ok(Number.isFinite(previous.x));
  assert.ok(previous.x < renderer.coverScreenRect(0, 80, 36).x);
});

test('no hover does not light the negative slot to the left of Chess', () => {
  const renderer = new CoverFlowRenderer(ARCADE_CATALOGUE, () => texture);
  const resting = new RenderTarget(240, 216);
  renderer.renderScene(resting, 0, null);
  const hoveredPrevious = new RenderTarget(240, 216);
  renderer.renderScene(hoveredPrevious, 0, -1);
  assert.notDeepEqual(resting.color, hoveredPrevious.color, 'negative slots remain hoverable but are not the empty-hover sentinel');
});

test('website title hold keeps a coherent card on an ultrawide terminal grid', () => {
  const renderer = new CoverFlowRenderer(ARCADE_CATALOGUE, () => texture);
  const target = new RenderTarget(218 * 3, 91 * 6);
  renderer.renderCinematic(target, 0, 0, 1);
  const bounds = geometryBounds(target);
  assert.ok(bounds.width > target.width * 0.45);
  assert.ok(bounds.width < target.width * 0.86);
  assert.ok(bounds.height > target.height * 0.62);
  assert.ok(bounds.height < target.height * 0.98);
});

function paintedPixels(target: RenderTarget): number {
  let count = 0;
  for (let i = 0; i < target.color.length; i += 3) if (target.color[i] || target.color[i + 1] || target.color[i + 2]) count++;
  return count;
}

function geometryBounds(target: RenderTarget): { width: number; height: number } {
  let minX = target.width, minY = target.height, maxX = -1, maxY = -1;
  for (let y = 0; y < target.height; y++) for (let x = 0; x < target.width; x++) {
    if (!Number.isFinite(target.depth[y * target.width + x])) continue;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return { width: maxX - minX + 1, height: maxY - minY + 1 };
}
