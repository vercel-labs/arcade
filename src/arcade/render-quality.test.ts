import assert from 'node:assert/strict';
import test from 'node:test';
import { PIXEL_SSAA_MAX_CELLS, supersampleForMode, supersampleForViewport } from './render-quality.ts';

test('pixel display uses a lower render supersample than glyph displays', () => {
  assert.equal(supersampleForMode('ascii'), 3);
  assert.equal(supersampleForMode('hybrid'), 3);
  assert.equal(supersampleForMode('pixels'), 2);
});

test('pixel display caps internal resolution only for exceptionally large viewports', () => {
  assert.equal(supersampleForViewport('pixels', 600, 200), 2);
  assert.equal(supersampleForViewport('pixels', 700, 210), 1);
  assert.equal(supersampleForViewport('pixels', PIXEL_SSAA_MAX_CELLS, 1), 2);
  assert.equal(supersampleForViewport('pixels', PIXEL_SSAA_MAX_CELLS + 1, 1), 1);
  assert.equal(supersampleForViewport('ascii', 900, 270), 3);
  assert.equal(supersampleForViewport('hybrid', 900, 270), 3);
});
