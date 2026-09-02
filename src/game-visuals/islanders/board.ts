import { type Mat4, mat4MulVec4, mat4Multiply, mat4RotY, mat4Scale, mat4Translate, type Mesh, type Vec3, type VertexIn } from '../../engine/index.ts';
import { coastalEdgeRing, edgeNodes, HEX_COORDS, hexNodes, NUM_NODES } from '../../rules/islanders/board-topology.ts';
import type { HarborSetup } from '../../rules/islanders/setup.ts';
import type { Resource } from '../../rules/islanders/types.ts';
import type { PortKind } from './port/spec.ts';
import { PORT_SAIL_CENTER } from './port/hull.ts';

const SQRT3 = Math.sqrt(3);
export const ISLANDERS_WATER_RADIUS = 5.8;
export const ISLANDERS_WATER_Y = -0.19;
const WATER_SUBDIVISIONS = 20;
const UP: Vec3 = { x: 0, y: 1, z: 0 };
const WHITE: Vec3 = { x: 255, y: 255, z: 255 };

export function hexWorld(q: number, r: number): { x: number; z: number } {
  return { x: 1.5 * q, z: SQRT3 * (q / 2 + r) };
}

export const NODE_XZ: { x: number; z: number }[] = (() => {
  const out = new Array<{ x: number; z: number }>(NUM_NODES);
  HEX_COORDS.forEach((coord, h) => {
    const center = hexWorld(coord.q, coord.r);
    for (let corner = 0; corner < 6; corner++) {
      const node = hexNodes[h][corner];
      if (out[node]) continue;
      const angle = (-Math.PI / 3) * corner;
      out[node] = { x: center.x + Math.cos(angle), z: center.z + Math.sin(angle) };
    }
  });
  return out;
})();

export const EDGE_ENDS = edgeNodes.map(([a, b]) => ({ x0: NODE_XZ[a].x, z0: NODE_XZ[a].z, x1: NODE_XZ[b].x, z1: NODE_XZ[b].z }));

export const BOARD_HARBOR_SCALE = 0.56;
export const BOARD_HARBOR_DISTANCE = 0.7;
export const BOARD_HARBOR_Y = ISLANDERS_WATER_Y;

export interface HarborConnector {
  shoreA: { x: number; z: number };
  shoreB: { x: number; z: number };
  vesselA: { x: number; z: number };
  vesselB: { x: number; z: number };
}

export interface BoardHarborPose {
  edge: number;
  kind: PortKind;
  model: Mat4;
  startModel: Mat4;
  forward: { x: number; z: number };
  outward: { x: number; z: number };
  sailCenter: { x: number; y: number; z: number };
  connector: HarborConnector;
}

/** The production rules' nine coastal edges mapped to the production board scale. */
export function boardHarborPoses(harbors: readonly HarborSetup[]): BoardHarborPose[] {
  return harbors.map((harbor) => {
    const edge = EDGE_ENDS[harbor.edge];
    const mid = { x: (edge.x0 + edge.x1) / 2, z: (edge.z0 + edge.z1) / 2 };
    const length = Math.hypot(edge.x1 - edge.x0, edge.z1 - edge.z0) || 1;
    let tx = (edge.x1 - edge.x0) / length, tz = (edge.z1 - edge.z0) / length;
    let localZ = { x: -tz, z: tx };
    if (localZ.x * mid.x + localZ.z * mid.z > 0) { tx = -tx; tz = -tz; localZ = { x: -tz, z: tx }; }
    const outward = { x: -localZ.x, z: -localZ.z };
    const center = { x: mid.x + outward.x * BOARD_HARBOR_DISTANCE, z: mid.z + outward.z * BOARD_HARBOR_DISTANCE };
    const yaw = Math.atan2(-tz, tx);
    const pose = (offset: number) => mat4Multiply(
      mat4Translate(center.x - tx * offset, BOARD_HARBOR_Y, center.z - tz * offset),
      mat4Multiply(mat4RotY(yaw), mat4Scale(BOARD_HARBOR_SCALE, BOARD_HARBOR_SCALE, BOARD_HARBOR_SCALE)),
    );
    const model = pose(0);
    const sail = mat4MulVec4(model, { ...PORT_SAIL_CENTER, w: 1 });
    const p0 = { x: edge.x0, z: edge.z0 }, p1 = { x: edge.x1, z: edge.z1 };
    const projection = (p: { x: number; z: number }): number => (p.x - mid.x) * tx + (p.z - mid.z) * tz;
    const negative = projection(p0) < projection(p1) ? p0 : p1;
    const positive = negative === p0 ? p1 : p0;
    const shore = (p: { x: number; z: number }) => ({ x: p.x + outward.x * 0.31, z: p.z + outward.z * 0.31 });
    const vessel = (along: number) => ({ x: center.x + tx * along - outward.x * 0.13, z: center.z + tz * along - outward.z * 0.13 });
    return {
      edge: harbor.edge,
      kind: (harbor.port.resource ?? 'generic') as Resource | 'generic',
      model,
      startModel: pose(1.65),
      forward: { x: tx, z: tz },
      outward,
      sailCenter: { x: sail.x, y: sail.y, z: sail.z },
      connector: { shoreA: shore(negative), shoreB: shore(positive), vesselA: vessel(-0.27), vesselB: vessel(0.27) },
    };
  });
}

/** The same finite pointy-top water frame used under Arcade's complete board. */
export function islandersWaterMesh(): Mesh {
  const vertices: VertexIn[] = [];
  const byCoord = new Map<string, number>();
  const key = (q: number, r: number) => `${q},${r}`;
  const step = ISLANDERS_WATER_RADIUS / WATER_SUBDIVISIONS;
  for (let q = -WATER_SUBDIVISIONS; q <= WATER_SUBDIVISIONS; q++) {
    const rMin = Math.max(-WATER_SUBDIVISIONS, -q - WATER_SUBDIVISIONS);
    const rMax = Math.min(WATER_SUBDIVISIONS, -q + WATER_SUBDIVISIONS);
    for (let r = rMin; r <= rMax; r++) {
      const x = step * (SQRT3 / 2) * q, z = step * (r + q / 2);
      byCoord.set(key(q, r), vertices.length);
      vertices.push({ position: { x, y: ISLANDERS_WATER_Y, z }, normal: UP, uv: [0.5 + x / 11.6, 0.5 + z / 11.6], color: WHITE });
    }
  }
  const indices: number[] = [];
  const tri = (a: string, b: string, c: string) => { const ai=byCoord.get(a),bi=byCoord.get(b),ci=byCoord.get(c); if(ai!==undefined&&bi!==undefined&&ci!==undefined) indices.push(ai,bi,ci); };
  for (let q=-WATER_SUBDIVISIONS;q<=WATER_SUBDIVISIONS;q++) for(let r=-WATER_SUBDIVISIONS;r<=WATER_SUBDIVISIONS;r++) {
    tri(key(q,r),key(q+1,r),key(q,r+1)); tri(key(q,r),key(q-1,r),key(q,r-1));
  }
  return { vertices, indices };
}

export const PRODUCTION_HARBOR_EDGES = coastalEdgeRing;
