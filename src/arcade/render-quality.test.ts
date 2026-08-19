import assert from 'node:assert/strict';
import test from 'node:test';
import { supersampleForMode } from './render-quality.ts';

test('pixel display uses a lower render supersample than glyph displays', () => {
  assert.equal(supersampleForMode('ascii'), 3);
  assert.equal(supersampleForMode('hybrid'), 3);
  assert.equal(supersampleForMode('pixels'), 2);
});
