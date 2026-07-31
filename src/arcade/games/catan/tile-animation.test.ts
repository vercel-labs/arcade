import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Mesh } from '../../../engine/index.ts';
import { animatedTileMesh, tileMesh } from './tile-mesh.ts';

const positions = (mesh: Mesh): number[] => mesh.vertices.flatMap((vertex) => [
  Number(vertex.position.x.toFixed(6)),
  Number(vertex.position.y.toFixed(6)),
  Number(vertex.position.z.toFixed(6)),
]);

function assertValid(mesh: Mesh): void {
  assert.ok(mesh.vertices.length > 0);
  assert.ok(mesh.vertices.every((vertex) => Number.isFinite(vertex.position.x) && Number.isFinite(vertex.position.y) && Number.isFinite(vertex.position.z)));
  assert.ok(mesh.indices.every((index) => index >= 0 && index < mesh.vertices.length));
}

test('animated tile overlays move while the dense terrain mesh remains cached', () => {
  const staticFields = tileMesh('fields', 4);
  assert.strictEqual(tileMesh('fields', 4), staticFields);

  const blades0 = animatedTileMesh('fields', 4, 0);
  const blades1 = animatedTileMesh('fields', 4, 0.7);
  assert.ok(blades0 && blades1);
  assertValid(blades0);
  assertValid(blades1);
  assert.equal(blades0.vertices.length, blades1.vertices.length);
  assert.notDeepEqual(positions(blades0), positions(blades1));

  const sheep0 = animatedTileMesh('pasture', 7, 0);
  const sheep1 = animatedTileMesh('pasture', 7, 3.2);
  assert.ok(sheep0 && sheep1);
  assertValid(sheep0);
  assertValid(sheep1);
  assert.equal(sheep0.vertices.length, sheep1.vertices.length);
  assert.notDeepEqual(positions(sheep0), positions(sheep1));
});

test('only fields and pasture allocate animated overlays', () => {
  for (const terrain of ['forest', 'hills', 'mountains', 'desert'] as const) {
    assert.equal(animatedTileMesh(terrain, 3, 1.5), null);
  }
});

test('walking sheep bodies follow the meadow without vertical noise jumps', () => {
  let previous = animatedTileMesh('pasture', 0, 0);
  assert.ok(previous);
  let largestBodyStep = 0;
  for (let frame = 1; frame <= 120; frame++) {
    const current = animatedTileMesh('pasture', 0, frame * 0.09);
    assert.ok(current);
    assert.equal(current.vertices.length, previous.vertices.length);
    for (let i = 0; i < current.vertices.length; i++) {
      if (current.vertices[i].color.x <= 200) continue; // white/cream body, excluding moving legs/head
      largestBodyStep = Math.max(largestBodyStep, Math.abs(current.vertices[i].position.y - previous.vertices[i].position.y));
    }
    previous = current;
  }
  assert.ok(largestBodyStep < 0.01, `body moved ${largestBodyStep.toFixed(4)} vertically in one 90ms frame`);
});
