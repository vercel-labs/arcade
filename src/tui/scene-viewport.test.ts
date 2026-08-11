import assert from 'node:assert/strict';
import test from 'node:test';
import { insetSceneViewport, pointerNdcInSceneViewport } from './scene-viewport.ts';

test('scene viewport insets reserve arbitrary terminal edges', () => {
  assert.deepEqual(insetSceneViewport(200, 60, { right: 36 }), { x: 0, y: 0, w: 164, h: 60 });
  assert.deepEqual(insetSceneViewport(30, 20, { right: 36 }), { x: 0, y: 0, w: 1, h: 20 });
  assert.deepEqual(
    insetSceneViewport(100, 50, { top: 2, right: 4, bottom: 6, left: 8 }),
    { x: 8, y: 2, w: 88, h: 42 },
  );
});

test('pointer NDC and camera aspect use the available scene viewport', () => {
  const viewport = insetSceneViewport(200, 60, { right: 36 });
  const center = pointerNdcInSceneViewport(82.5, 30.5, viewport, 2);
  assert.equal(center.ndcX, 0);
  assert.equal(center.ndcY, 0);
  assert.equal(center.aspect, 164 / 120);

  const underRail = pointerNdcInSceneViewport(180, 30.5, viewport, 2);
  assert.ok(underRail.ndcX > 1, 'the chat rail lies outside the scene projection');
  assert.throws(() => pointerNdcInSceneViewport(1, 1, viewport, 0), /must be positive/);
});
