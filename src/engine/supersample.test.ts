import assert from 'node:assert/strict';
import test from 'node:test';
import { RenderTarget } from './framebuffer.ts';
import { downsample } from './supersample.ts';

test('downsample preserves nearest finite depth for foreground coverage', () => {
  const source = new RenderTarget(4, 2);
  source.clear();
  source.depth[1] = 0.4;
  source.depth[2] = 0.2;

  const result = downsample(source, 2);

  assert.ok(Math.abs(result.depth[0] - 0.4) < 1e-6);
  assert.ok(Math.abs(result.depth[1] - 0.2) < 1e-6);
});
