import { type Raycaster, type Vec3 } from '../../../../engine/index.ts';
import { NUM_EDGES, NUM_NODES } from '../../../../rules/catan/board-topology.ts';
import {
  BOARD_BUILDING_RADIUS,
  BOARD_CITY_HEIGHT,
  BOARD_ROAD_HALF_WIDTH,
  BOARD_ROAD_LENGTH_SCALE,
  BOARD_SETTLEMENT_HEIGHT,
} from '../mesh/pieces.ts';
import { EDGE_ENDS, NODE_XZ, PROBE_Y } from './board-layout.ts';

export type BoardPickTarget = { kind: 'node' | 'edge'; id: number };

export interface BoardPickMeasurement extends BoardPickTarget {
  /** Screen-space distance to the semantic piece silhouette. */
  distance: number;
  /** Screen-space radius around that silhouette. */
  radius: number;
  /** Distance normalized by radius; <= 1 is a hit. */
  score: number;
}

export type BuildingAtNode = (node: number) => { city: boolean } | undefined;

const NODE_MIN_RADIUS = 0.06;
const ROAD_MIN_RADIUS = 0.028;

function metricProjectedRadius(raycaster: Raycaster, center: Vec3, offset: Vec3): number {
  const a = raycaster.project(center);
  const b = raycaster.project({ x: center.x + offset.x, y: center.y + offset.y, z: center.z + offset.z });
  if (a.behind || b.behind) return 0;
  return Math.hypot((b.x - a.x) * raycaster.aspect, b.y - a.y);
}

function nodeMeasurement(raycaster: Raycaster, node: number, buildingAt: BuildingAtNode): BoardPickMeasurement {
  const p = NODE_XZ[node];
  const building = buildingAt(node);
  // Empty vertices preview a settlement, so their hit silhouette matches that ghost. Existing
  // cities extend the capsule to their taller roof rather than remaining anchored to the rim.
  const height = building?.city ? BOARD_CITY_HEIGHT : BOARD_SETTLEMENT_HEIGHT;
  const base = { x: p.x, y: PROBE_Y, z: p.z };
  const top = { x: p.x, y: PROBE_Y + height, z: p.z };
  const segment = raycaster.projectedSegmentDistance(base, top, true);
  const projectedRadius = Math.max(
    metricProjectedRadius(raycaster, base, { x: BOARD_BUILDING_RADIUS, y: 0, z: 0 }),
    metricProjectedRadius(raycaster, base, { x: 0, y: 0, z: BOARD_BUILDING_RADIUS }),
  );
  const radius = Math.max(NODE_MIN_RADIUS, projectedRadius);
  const distance = segment?.distance ?? Infinity;
  return { kind: 'node', id: node, distance, radius, score: distance / radius };
}

function roadMeasurement(raycaster: Raycaster, edge: number): BoardPickMeasurement {
  const e = EDGE_ENDS[edge];
  const mx = (e.x0 + e.x1) / 2;
  const mz = (e.z0 + e.z1) / 2;
  const half = BOARD_ROAD_LENGTH_SCALE / 2;
  const dx = e.x1 - e.x0;
  const dz = e.z1 - e.z0;
  const start = { x: mx - dx * half, y: PROBE_Y, z: mz - dz * half };
  const end = { x: mx + dx * half, y: PROBE_Y, z: mz + dz * half };
  const segment = raycaster.projectedSegmentDistance(start, end, true);
  const length = Math.hypot(dx, dz) || 1;
  const side = {
    x: (-dz / length) * BOARD_ROAD_HALF_WIDTH,
    y: 0,
    z: (dx / length) * BOARD_ROAD_HALF_WIDTH,
  };
  const radius = Math.max(ROAD_MIN_RADIUS, metricProjectedRadius(raycaster, start, side));
  const distance = segment?.distance ?? Infinity;
  return { kind: 'edge', id: edge, distance, radius, score: distance / radius };
}

export function measureBoardTarget(
  raycaster: Raycaster,
  target: BoardPickTarget,
  buildingAt: BuildingAtNode,
): BoardPickMeasurement {
  return target.kind === 'node'
    ? nodeMeasurement(raycaster, target.id, buildingAt)
    : roadMeasurement(raycaster, target.id);
}

/**
 * Resolve a placement target using semantic screen-space shapes. Nodes deliberately win when
 * their building/ghost silhouette is hit; roads are considered outside those node regions.
 */
export function pickBoardTarget(
  raycaster: Raycaster,
  buildingAt: BuildingAtNode,
  radiusScale = 1,
): BoardPickMeasurement | null {
  let node: BoardPickMeasurement | null = null;
  for (let id = 0; id < NUM_NODES; id++) {
    const hit = nodeMeasurement(raycaster, id, buildingAt);
    if (hit.score <= radiusScale && (!node || hit.score < node.score)) node = hit;
  }
  if (node) return node;

  let edge: BoardPickMeasurement | null = null;
  for (let id = 0; id < NUM_EDGES; id++) {
    const hit = roadMeasurement(raycaster, id);
    if (hit.score <= radiusScale && (!edge || hit.score < edge.score)) edge = hit;
  }
  return edge;
}
