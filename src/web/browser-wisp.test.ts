import assert from 'node:assert/strict';
import test from 'node:test';
import { cameraMatrices, type Camera } from '../engine/camera.ts';
import { RenderTarget } from '../engine/framebuffer.ts';
import { BrowserCreatorWisps, cinematicWispVisible } from './browser-wisp.ts';
import type { Texture } from '../engine/texture-data.ts';

const CAMERA: Camera = {
  eye: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: -1 }, up: { x: 0, y: 1, z: 0 },
  fovy: Math.PI / 3, near: 0.05, far: 100,
};

test('browser wisps do not paint when their billboard intersects or sits behind the camera', () => {
  const target = new RenderTarget(240, 135);
  target.clear();
  const vp = cameraMatrices(CAMERA, target.width / target.height).viewProjection;
  const wisps = new BrowserCreatorWisps();
  wisps.draw(target, vp, CAMERA, 'openai', { x: 0, y: 0, z: 0.2 }, 0.4, 0, 0.72);
  wisps.draw(target, vp, CAMERA, 'openai', { x: 0, y: 0, z: -0.3 }, 0.4, 0, 0.72);
  wisps.draw(target, vp, CAMERA, 'openai', { x: 0, y: 0, z: -2.4 }, 0.4, 0, 0.72);
  assert.ok(target.color.every((channel) => channel === 0));
});

test('every cinematic wisp host shares the camera-plane visibility gate', () => {
  const vp = cameraMatrices(CAMERA, 16 / 9).viewProjection;
  assert.equal(cinematicWispVisible(vp, { x: 0, y: 0, z: -0.3 }, 0.72), false);
  assert.equal(cinematicWispVisible(vp, { x: 0, y: 0, z: -4 }, 0.72), true);
});

test('non-browser hosts can inject a decoded creator mark', () => {
  const mark: Texture = { width: 2, height: 2, data: new Uint8Array([
    255, 255, 255, 255, 255, 255, 255, 255,
    255, 255, 255, 255, 255, 255, 255, 255,
  ]) };
  assert.equal(new BrowserCreatorWisps().hasTexture('openai'), false);
  assert.equal(new BrowserCreatorWisps({ openai: mark }).hasTexture('openai'), true);
});
