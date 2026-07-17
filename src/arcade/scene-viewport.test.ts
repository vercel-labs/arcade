import assert from 'node:assert/strict';
import test from 'node:test';
import { insetRightSceneViewport, pointerNdcInSceneViewport } from './scene-viewport.ts';

test('a right rail reduces the real scene viewport without moving its left edge', () => {
  assert.deepEqual(insetRightSceneViewport(200, 60, 36), { x: 0, y: 0, w: 164, h: 60 });
  assert.deepEqual(insetRightSceneViewport(30, 20, 36), { x: 0, y: 0, w: 1, h: 20 });
});

test('pointer NDC and camera aspect use the available scene viewport', () => {
  const viewport = insetRightSceneViewport(200, 60, 36);
  const center = pointerNdcInSceneViewport(82.5, 30.5, viewport);
  assert.equal(center.ndcX, 0);
  assert.equal(center.ndcY, 0);
  assert.equal(center.aspect, 164 / 120);

  const underRail = pointerNdcInSceneViewport(180, 30.5, viewport);
  assert.ok(underRail.ndcX > 1, 'the chat rail lies outside the scene projection');
});
