import { nearestHit, type Raycaster } from '../../../../engine/index.ts';
import { NUM_EDGES, NUM_NODES } from '../../../../rules/islanders/board-topology.ts';
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

function nodeMeasurement(raycaster: Raycaster, node: number, buildingAt: BuildingAtNode): BoardPickMeasurement {
  const p = NODE_XZ[node];
  const building = buildingAt(node);
  // Empty vertices preview a settlement, so their hit silhouette matches that ghost. Existing
  // cities extend the capsule to their taller roof rather than remaining anchored to the rim.
  const height = building?.city ? BOARD_CITY_HEIGHT : BOARD_SETTLEMENT_HEIGHT;
  const base = { x: p.x, y: PROBE_Y, z: p.z };
  const top = { x: p.x, y: PROBE_Y + height, z: p.z };
  const hit = raycaster.projectedCapsule(
    base,
    top,
    [
      { x: BOARD_BUILDING_RADIUS, y: 0, z: 0 },
      { x: 0, y: 0, z: BOARD_BUILDING_RADIUS },
    ],
    NODE_MIN_RADIUS,
  );
  return { kind: 'node', id: node, ...hit };
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
  const length = Math.hypot(dx, dz) || 1;
  const side = {
    x: (-dz / length) * BOARD_ROAD_HALF_WIDTH,
    y: 0,
    z: (dx / length) * BOARD_ROAD_HALF_WIDTH,
  };
  const hit = raycaster.projectedCapsule(start, end, [side], ROAD_MIN_RADIUS);
  return { kind: 'edge', id: edge, ...hit };
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
  const hits: BoardPickMeasurement[] = [];
  for (let id = 0; id < NUM_NODES; id++) {
    hits.push(nodeMeasurement(raycaster, id, buildingAt));
  }
  for (let id = 0; id < NUM_EDGES; id++) {
    hits.push(roadMeasurement(raycaster, id));
  }
  return nearestHit(hits, {
    maxScore: radiusScale,
    priority: (hit) => hit.kind === 'node' ? 0 : 1,
  });
}
