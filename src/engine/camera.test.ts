import assert from 'node:assert/strict';
import test from 'node:test';
import { cameraMatrices, type Camera } from './camera.ts';
import { mat4MulVec4 } from './math.ts';

const BASE: Camera = {
  eye: { x: 0, y: 0, z: 4 }, target: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 },
  fovy: Math.PI / 3, near: 0.1, far: 100,
};

test('camera film shift moves framing without changing world geometry', () => {
  const center = project(BASE);
  const shifted = project({ ...BASE, ndcOffsetX: -0.34, ndcOffsetY: -0.12 });
  assert.ok(shifted.x < center.x, 'negative horizontal film shift should move the world left');
  assert.ok(shifted.y < center.y, 'negative vertical film shift should move the world down');
});

function project(camera: Camera): { x: number; y: number } {
  const clip = mat4MulVec4(cameraMatrices(camera, 16 / 9).viewProjection, { x: 0, y: 0, z: 0, w: 1 });
  return { x: clip.x / clip.w, y: clip.y / clip.w };
}
