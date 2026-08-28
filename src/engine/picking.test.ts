import assert from 'node:assert/strict';
import test from 'node:test';
import { mat4Identity } from './math.ts';
import { projectedDiscHit, projectedPolygonFootprint } from './picking.ts';

test('projectedPolygonFootprint reports a linear viewport-area scale', () => {
  const footprint = projectedPolygonFootprint(mat4Identity(), [
    { x: -0.5, y: -0.5, z: 0 },
    { x: 0.5, y: -0.5, z: 0 },
    { x: 0.5, y: 0.5, z: 0 },
    { x: -0.5, y: 0.5, z: 0 },
  ], 100, 100);
  assert.equal(footprint, 50);
});

test('projected disc hits include their normalized score', () => {
  const hit = projectedDiscHit(
    mat4Identity(),
    { x: 0, y: 0, z: 0 },
    { x: 0.5, y: 0, z: 0 },
    0.25,
    0,
  );
  assert.equal(hit?.distance, 0.25);
  assert.equal(hit?.radius, 0.5);
  assert.equal(hit?.score, 0.5);
});
