// Where the board's hexes, settlement nodes and roads sit in world space, derived once from the
// topology, plus the projection used to hit-test them against the cursor.

import { type Mat4, mat4MulVec4 } from '../../../../engine/index.ts';
import { edgeNodes, HEX_COORDS, hexNodes, NUM_NODES } from '../../../../rules/catan/board-topology.ts';

const SQRT3 = Math.sqrt(3);

// Flat-top axial (q,r) → world (x,z). Size = the tile's outer radius (R_OUT = 1), so
// neighbours meet edge-to-edge. See board-topology.ts for the hex coordinate system.
export function hexWorld(q: number, r: number): { x: number; z: number } {
  return { x: 1.5 * q, z: SQRT3 * (q / 2 + r) };
}
// Hex ring index (distance from the center hex) — the primary key for center-out ordering.
export function hexRing(q: number, r: number): number {
  return (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
}

// World (x,z) of every settlement/road node (a shared hex corner) and edge, derived once from
// the topology + flat-top layout. Corner k of a hex sits at angle −60°·k, radius R_OUT (=1).
export const NODE_XZ: { x: number; z: number }[] = (() => {
  const out: { x: number; z: number }[] = new Array(NUM_NODES);
  HEX_COORDS.forEach((coord, h) => {
    const w = hexWorld(coord.q, coord.r);
    for (let k = 0; k < 6; k++) {
      const nid = hexNodes[h][k];
      if (out[nid]) continue;
      const a = (-Math.PI / 3) * k;
      out[nid] = { x: w.x + Math.cos(a), z: w.z + Math.sin(a) };
    }
  });
  return out;
})();
export const EDGE_ENDS = edgeNodes.map(([a, b]) => ({ x0: NODE_XZ[a].x, z0: NODE_XZ[a].z, x1: NODE_XZ[b].x, z1: NODE_XZ[b].z }));
export const EDGE_MID = EDGE_ENDS.map((e) => ({ x: (e.x0 + e.x1) / 2, z: (e.z0 + e.z1) / 2 }));
export const PROBE_Y = 0.05; // height at which nodes/edges are projected for hit-testing
// Project a board (x,z) point to NDC with the given view-projection; null if behind the camera.
export function projXZ(vp: Mat4, x: number, z: number): { x: number; y: number } | null {
  const c = mat4MulVec4(vp, { x, y: PROBE_Y, z, w: 1 });
  if (c.w <= 0.0001) return null;
  return { x: c.x / c.w, y: c.y / c.w };
}
