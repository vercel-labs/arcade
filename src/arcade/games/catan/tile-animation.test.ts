import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Mesh } from '../../../engine/index.ts';
import { animatedTileMesh, tileMesh } from './mesh/index.ts';
import { sampleWind } from './mesh/tiles/wind.ts';

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

test('weather overlays cover wind-responsive terrain while mountains remain still', () => {
  assert.equal(animatedTileMesh('mountains', 3, 82), null);
  for (const terrain of ['fields', 'forest', 'pasture', 'desert', 'hills'] as const) {
    const animated = animatedTileMesh(terrain, 3, 82);
    assert.ok(animated);
    assertValid(animated);
  }
  // Sand fully disappears during a calm state instead of looping forever.
  assert.equal(animatedTileMesh('desert', 3, 0)?.vertices.length, 0);
});

test('wind has calm and gust states and stays geographically coherent across nearby hexes', () => {
  assert.equal(sampleWind(0, 0, 0).strength, 0);
  const center = sampleWind(82, 0, 0);
  const neighbour = sampleWind(82, 1.5, Math.sqrt(3) / 2);
  assert.ok(center.strength > 0.5);
  assert.ok(Math.abs(center.strength - neighbour.strength) < 0.15);
  assert.ok(center.x * neighbour.x + center.z * neighbour.z > 0.995);
  const distant = sampleWind(82, 7, 0);
  assert.ok(Math.abs(center.strength - distant.strength) > 0.2, 'a gust front should vary across distant regions');
});

test('forest crowns move with weather while their cached ground remains stable', () => {
  const staticForest = tileMesh('forest', 5);
  assert.strictEqual(tileMesh('forest', 5), staticForest);
  const calm = animatedTileMesh('forest', 5, 0);
  const gust = animatedTileMesh('forest', 5, 82);
  assert.ok(calm && gust);
  assertValid(calm);
  assertValid(gust);
  assert.equal(calm.vertices.length, gust.vertices.length);
  assert.notDeepEqual(positions(calm), positions(gust));
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

test('quarry cattle walk level while the wagon trails through turns', () => {
  const staticHills = tileMesh('hills', 0);
  assert.strictEqual(tileMesh('hills', 0), staticHills);
  const start = animatedTileMesh('hills', 0, 0);
  const turn = animatedTileMesh('hills', 0, 12);
  assert.ok(start && turn);
  assertValid(start);
  assertValid(turn);
  assert.equal(start.vertices.length, turn.vertices.length);
  assert.notDeepEqual(positions(start), positions(turn));

  const centroid = (mesh: Mesh, accepts: (color: Mesh['vertices'][number]['color']) => boolean): { x: number; z: number } => {
    let x = 0;
    let z = 0;
    let count = 0;
    for (const vertex of mesh.vertices) {
      if (!accepts(vertex.color)) continue;
      x += vertex.position.x;
      z += vertex.position.z;
      count++;
    }
    assert.ok(count > 0);
    return { x: x / count, z: z / count };
  };
  const hitchAngle = (mesh: Mesh): number => {
    const cattle = centroid(mesh, (color) => color.x > 150 && color.x < 190 && color.y > 115 && color.y < 170);
    const cargo = centroid(mesh, (color) => color.x > 190 && color.y < 120 && color.z < 110);
    return Math.atan2(cattle.z - cargo.z, cattle.x - cargo.x);
  };
  const assertCattleLeadWagon = (mesh: Mesh): void => {
    const cattle = centroid(mesh, (color) => color.x > 150 && color.x < 190 && color.y > 115 && color.y < 170);
    const horns = centroid(mesh, (color) => color.x > 215 && color.y > 195 && color.z > 150 && color.z < 190);
    const cargo = centroid(mesh, (color) => color.x > 190 && color.y < 120 && color.z < 110);
    const facingX = horns.x - cattle.x;
    const facingZ = horns.z - cattle.z;
    const trailingX = cattle.x - cargo.x;
    const trailingZ = cattle.z - cargo.z;
    assert.ok(facingX * trailingX + facingZ * trailingZ > 0, 'cattle should face ahead with the wagon trailing behind');
  };
  assertCattleLeadWagon(start);
  assertCattleLeadWagon(turn);
  const angleChange = Math.abs(Math.atan2(Math.sin(hitchAngle(turn) - hitchAngle(start)), Math.cos(hitchAngle(turn) - hitchAngle(start))));
  assert.ok(angleChange > 0.5, 'wagon hitch should articulate rather than copy one rigid transform');

  let previous = start;
  let largestBodyStep = 0;
  for (let frame = 1; frame <= 120; frame++) {
    const current = animatedTileMesh('hills', 0, frame * 0.09);
    assert.ok(current);
    assert.equal(current.vertices.length, previous.vertices.length);
    for (let i = 0; i < current.vertices.length; i++) {
      const color = current.vertices[i].color;
      if (!(color.x > 150 && color.x < 190 && color.y > 115 && color.y < 170)) continue;
      largestBodyStep = Math.max(largestBodyStep, Math.abs(current.vertices[i].position.y - previous.vertices[i].position.y));
    }
    previous = current;
  }
  assert.ok(largestBodyStep < 0.012, `cattle body moved ${largestBodyStep.toFixed(4)} vertically in one 90ms frame`);
});

test('quarry variants change secondary terrain details and cattle starting states', () => {
  const staticVariants = [0, 1, 2, 3].map((seed) => tileMesh('hills', seed));
  for (const mesh of staticVariants) assertValid(mesh);
  assert.ok(
    new Set(staticVariants.map((mesh) => mesh.vertices.length)).size > 1,
    'seeded rock formations and trestles should not all share one topology',
  );

  const cattleVariants = [0, 1, 2, 3].map((seed) => animatedTileMesh('hills', seed, 8));
  for (const mesh of cattleVariants) {
    assert.ok(mesh);
    assertValid(mesh);
  }
  assert.notDeepEqual(positions(cattleVariants[0]!), positions(cattleVariants[1]!));
});
