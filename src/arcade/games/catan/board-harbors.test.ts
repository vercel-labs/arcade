import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mat4MulVec4, mulberry32 } from '../../../engine/index.ts';
import { generateBoard } from '../../../rules/catan/setup.ts';
import { BEACH_OUTER_WIDTH, coastMesh, harborPiersMesh, portMesh, shoreWaveField, surfMesh, swashMesh } from './mesh/index.ts';
import { EDGE_ENDS } from './scene/board-layout.ts';
import { boardHarborPoses } from './scene/harbors.ts';
import { CATAN_WATER_RADIUS_X, CATAN_WATER_RADIUS_Z } from './water.ts';

function connectorLength(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function radialExtent(mesh: { vertices: readonly { position: { x: number; z: number } }[] }): number {
  return Math.max(0, ...mesh.vertices.map((vertex) => Math.hypot(vertex.position.x, vertex.position.z)));
}

function isInsideWater(x: number, z: number): boolean {
  const ax = Math.abs(x);
  const az = Math.abs(z);
  const xLimit = CATAN_WATER_RADIUS_X * Math.sqrt(3) / 2;
  const zLimit = CATAN_WATER_RADIUS_Z - (ax * CATAN_WATER_RADIUS_Z) / (Math.sqrt(3) * CATAN_WATER_RADIUS_X);
  return ax <= xLimit + 1e-9 && az <= zLimit + 1e-9;
}

test('board harbor poses preserve all nine rule ports and place every boat outside its coast', () => {
  const board = generateBoard(mulberry32(17));
  const poses = boardHarborPoses(board.harbors);
  assert.equal(poses.length, 9);
  assert.equal(poses.filter((pose) => pose.kind === 'generic').length, 4);
  assert.deepEqual(
    poses.filter((pose) => pose.kind !== 'generic').map((pose) => pose.kind).sort(),
    ['brick', 'grain', 'lumber', 'ore', 'wool'],
  );

  for (const pose of poses) {
    const edge = EDGE_ENDS[pose.edge];
    const midpoint = { x: (edge.x0 + edge.x1) / 2, z: (edge.z0 + edge.z1) / 2 };
    const center = mat4MulVec4(pose.model, { x: 0, y: 0, z: 0, w: 1 });
    assert.ok(Math.hypot(center.x, center.z) > Math.hypot(midpoint.x, midpoint.z));
    assert.notDeepEqual(pose.connector.shoreA, pose.connector.shoreB);
    assert.notDeepEqual(pose.connector.vesselA, pose.connector.vesselB);
    assert.ok(
      Math.abs(
        connectorLength(pose.connector.shoreA, pose.connector.vesselA) -
          connectorLength(pose.connector.shoreB, pose.connector.vesselB),
      ) < 1e-9,
    );
    assert.ok(Number.isFinite(pose.sailCenter.x));
    assert.ok(Number.isFinite(pose.sailCenter.y));
    assert.ok(Number.isFinite(pose.sailCenter.z));
    assert.ok(Math.abs(Math.hypot(pose.forward.x, pose.forward.z) - 1) < 1e-9);
    assert.ok(Math.abs(Math.hypot(pose.outward.x, pose.outward.z) - 1) < 1e-9);
    assert.ok(Math.abs(pose.forward.x * pose.outward.x + pose.forward.z * pose.outward.z) < 1e-9);
  }
});

test('every complete board harbor boat remains over the finite water hex', () => {
  const board = generateBoard(mulberry32(17));
  const poses = boardHarborPoses(board.harbors);
  for (const [index, pose] of poses.entries()) {
    const boat = portMesh(pose.kind, index + 1);
    for (const vertex of boat.vertices) {
      const world = mat4MulVec4(pose.model, { ...vertex.position, w: 1 });
      assert.ok(isInsideWater(world.x, world.z), `harbor ${index} vertex escaped the water at ${world.x}, ${world.z}`);
    }
  }
});

test('the nine board ports produce finite paired-jetty geometry', () => {
  const board = generateBoard(mulberry32(29));
  const poses = boardHarborPoses(board.harbors);
  const connectors = poses.map((pose) => pose.connector);
  const hidden = harborPiersMesh(connectors, 0);
  const entering = harborPiersMesh(connectors, 0.5);
  const mesh = harborPiersMesh(connectors);
  assert.equal(hidden.vertices.length, 0);
  assert.ok(entering.vertices.length > 0);
  assert.ok(radialExtent(entering) < radialExtent(mesh));
  assert.ok(mesh.vertices.length > 0);
  assert.ok(mesh.indices.length > 0);
  assert.equal(mesh.indices.length % 3, 0);
  for (const vertex of mesh.vertices) {
    assert.ok(Number.isFinite(vertex.position.x));
    assert.ok(Number.isFinite(vertex.position.y));
    assert.ok(Number.isFinite(vertex.position.z));
  }
});

test('the beach is continuous board geometry and its broken surf changes over time', () => {
  const hiddenCoast = coastMesh(0);
  const growingCoast = coastMesh(0.5);
  const coast = coastMesh();
  const early = surfMesh(0.1);
  const later = surfMesh(0.9);
  const earlySwash = swashMesh(0.1);
  const laterSwash = swashMesh(0.9);
  assert.ok(BEACH_OUTER_WIDTH > 0.25 && BEACH_OUTER_WIDTH < 0.5);
  assert.ok(radialExtent(hiddenCoast) < radialExtent(growingCoast));
  assert.ok(radialExtent(growingCoast) < radialExtent(coast));
  assert.ok(coast.vertices.length > 0);
  assert.ok(early.vertices.length > 0);
  assert.ok(later.vertices.length > 0);
  assert.notDeepEqual(earlySwash.vertices, laterSwash.vertices);
  assert.notDeepEqual(early.vertices, later.vertices);
  for (const mesh of [coast, earlySwash, laterSwash, early, later]) {
    assert.equal(mesh.indices.length % 3, 0);
    assert.ok(mesh.vertices.every((vertex) => Number.isFinite(vertex.position.x) && Number.isFinite(vertex.position.y) && Number.isFinite(vertex.position.z)));
  }
});

test('shore waves share one direction, wrap around the flanks, and leave a leeward shadow', () => {
  const time = 14;
  const travel = shoreWaveField(1, 0, time).travel;
  const radius = 4;
  const windward = shoreWaveField(-travel.x * radius, -travel.z * radius, time);
  const flank = shoreWaveField(-travel.z * radius, travel.x * radius, time);
  const leeward = shoreWaveField(travel.x * radius, travel.z * radius, time);

  assert.ok(windward.exposure > 0.95);
  assert.ok(flank.exposure > leeward.exposure);
  assert.ok(windward.exposure > flank.exposure);
  assert.ok(leeward.exposure > 0.15 && leeward.exposure < 0.25);
  for (let step = 0; step < 24; step++) {
    const field = shoreWaveField(Math.cos(step) * radius, Math.sin(step) * radius, time + step * 0.13);
    assert.ok(field.energy >= 0 && field.energy <= 1);
    assert.ok(Number.isFinite(field.energy));
  }

  // Weather direction drifts rather than snapping or rotating visibly from frame to frame.
  const shortlyAfter = shoreWaveField(1, 0, time + 2).travel;
  assert.ok(travel.x * shortlyAfter.x + travel.z * shortlyAfter.z > 0.998);
});
