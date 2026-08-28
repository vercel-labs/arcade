import assert from 'node:assert/strict';
import test from 'node:test';
import { OrbitCamera, Raycaster, type Vec3 } from '../../../../engine/index.ts';
import {
  BOARD_CITY_HEIGHT,
  BOARD_ROAD_LENGTH_SCALE,
} from '../mesh/pieces.ts';
import { EDGE_ENDS, NODE_XZ, PROBE_Y } from './board-layout.ts';
import { measureBoardTarget, pickBoardTarget } from './placement-picking.ts';

const FOVY = (44 * Math.PI) / 180;
const ASPECT = 150 / 140;
const camera = new OrbitCamera({
  azimuth: 0.62,
  elevation: 0.82,
  distance: 9,
  target: { x: 0.25, y: -0.48, z: 0 },
}).toCamera({ fovy: FOVY, near: 0.05, far: 100 });

function raycasterAt(point: Vec3): Raycaster {
  const projector = new Raycaster().setFromCamera(camera, 0, 0, ASPECT);
  const projected = projector.project(point);
  assert.equal(projected.behind, false);
  return new Raycaster().setFromCamera(camera, projected.x, projected.y, ASPECT);
}

function visibleRoadPoint(edge: number, t: number): Vec3 {
  const e = EDGE_ENDS[edge];
  const mx = (e.x0 + e.x1) / 2;
  const mz = (e.z0 + e.z1) / 2;
  const half = BOARD_ROAD_LENGTH_SCALE / 2;
  const start = { x: mx - (e.x1 - e.x0) * half, z: mz - (e.z1 - e.z0) * half };
  const end = { x: mx + (e.x1 - e.x0) * half, z: mz + (e.z1 - e.z0) * half };
  return {
    x: start.x + (end.x - start.x) * t,
    y: PROBE_Y,
    z: start.z + (end.z - start.z) * t,
  };
}

test('road picking follows the complete rendered road segment rather than its midpoint', () => {
  const edge = 31;
  for (const t of [0.12, 0.5, 0.88]) {
    const point = visibleRoadPoint(edge, t);
    const raycaster = raycasterAt(point);
    const hit = measureBoardTarget(raycaster, { kind: 'edge', id: edge }, () => undefined);
    assert.ok(hit.score < 1e-8, `visible road point ${t} missed by ${hit.distance}`);
  }
});

test('city picking covers the roof instead of only its ground anchor', () => {
  const node = 22;
  const p = NODE_XZ[node];
  const roof = { x: p.x, y: PROBE_Y + BOARD_CITY_HEIGHT, z: p.z };
  const hit = pickBoardTarget(raycasterAt(roof), (id) => id === node ? { city: true } : undefined);
  assert.deepEqual(hit && { kind: hit.kind, id: hit.id }, { kind: 'node', id: node });
  assert.ok(hit && hit.score < 1e-8);
});

test('settlement nodes take precedence at road endpoints', () => {
  const node = 22;
  const p = NODE_XZ[node];
  const hit = pickBoardTarget(raycasterAt({ x: p.x, y: PROBE_Y, z: p.z }), () => undefined);
  assert.deepEqual(hit && { kind: hit.kind, id: hit.id }, { kind: 'node', id: node });
});
