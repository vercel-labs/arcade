// The board's sea: one finite, flat-top hexagon beneath the 19 land tiles. A triangular lattice
// gives the water material enough vertices to form gentle physical swells; the substantially
// finer ripple detail remains in the material so this CPU renderer does not need a huge mesh.

import type { Mesh, Vec3, VertexIn } from '../../../engine/index.ts';
import { HEX_COORDS } from '../../../rules/catan/board-topology.ts';

// The 19-tile island's macro silhouette points north/south even though each terrain hex is
// flat-top. Use one radius on both world axes so the sea frame is a true pointy-top hex aligned
// with that silhouette. This leaves enough room for the closer harbor boats without the broad
// empty-water border of the previous oversized frame.
export const CATAN_WATER_RADIUS = 5.8;
export const CATAN_WATER_RADIUS_X = CATAN_WATER_RADIUS;
export const CATAN_WATER_RADIUS_Z = CATAN_WATER_RADIUS;
export const CATAN_WATER_Y = -0.19; // just below the tile walls (which bottom out at -0.16)
export const CATAN_WATER_SUBDIVISIONS = 20;

const UP: Vec3 = { x: 0, y: 1, z: 0 };
const COLOR: Vec3 = { x: 255, y: 255, z: 255 }; // material supplies the actual palette
// A lattice triangle is removed only when all three corners are inside the
// settled tile union, so every triangle crossing the shoreline remains.
const SETTLED_LAND_OCCLUSION_RADIUS = 1;
const SQRT3 = Math.sqrt(3);

export interface CatanWaterMeshOptions {
  omitSettledLand?: boolean;
}

function coveredBySettledLand(x: number, z: number): boolean {
  const radius = SETTLED_LAND_OCCLUSION_RADIUS;
  for (const { q, r } of HEX_COORDS) {
    const cx = 1.5 * q;
    const cz = SQRT3 * (q / 2 + r);
    const dx = Math.abs(x - cx);
    const dz = Math.abs(z - cz);
    if (
      dx <= radius &&
      dz <= (SQRT3 * radius) / 2 &&
      SQRT3 * dx + dz <= SQRT3 * radius
    ) return true;
  }
  return false;
}

export function catanWaterMesh(options: CatanWaterMeshOptions = {}): Mesh {
  const vertices: VertexIn[] = [];
  const byCoord = new Map<string, number>();
  const stepX = CATAN_WATER_RADIUS_X / CATAN_WATER_SUBDIVISIONS;
  const stepZ = CATAN_WATER_RADIUS_Z / CATAN_WATER_SUBDIVISIONS;
  const key = (q: number, r: number): string => `${q},${r}`;

  // Axial coordinates describe a regular triangular lattice clipped to a pointy-top hex,
  // matching the orientation of the complete radius-2 island rather than each individual tile.
  for (let q = -CATAN_WATER_SUBDIVISIONS; q <= CATAN_WATER_SUBDIVISIONS; q++) {
    const rMin = Math.max(-CATAN_WATER_SUBDIVISIONS, -q - CATAN_WATER_SUBDIVISIONS);
    const rMax = Math.min(CATAN_WATER_SUBDIVISIONS, -q + CATAN_WATER_SUBDIVISIONS);
    for (let r = rMin; r <= rMax; r++) {
      const x = stepX * (Math.sqrt(3) / 2) * q;
      const z = stepZ * (r + q / 2);
      byCoord.set(key(q, r), vertices.length);
      vertices.push({
        position: { x, y: CATAN_WATER_Y, z },
        normal: UP,
        uv: [0.5 + x / (CATAN_WATER_RADIUS_X * 2), 0.5 + z / (CATAN_WATER_RADIUS_Z * 2)],
        color: COLOR,
      });
    }
  }

  const indices: number[] = [];
  const triangle = (a: string, b: string, c: string): void => {
    const ai = byCoord.get(a);
    const bi = byCoord.get(b);
    const ci = byCoord.get(c);
    if (ai === undefined || bi === undefined || ci === undefined) return;
    if (
      options.omitSettledLand &&
      coveredBySettledLand(vertices[ai].position.x, vertices[ai].position.z) &&
      coveredBySettledLand(vertices[bi].position.x, vertices[bi].position.z) &&
      coveredBySettledLand(vertices[ci].position.x, vertices[ci].position.z)
    ) return;
    indices.push(ai, bi, ci);
  };
  for (let q = -CATAN_WATER_SUBDIVISIONS; q <= CATAN_WATER_SUBDIVISIONS; q++) {
    for (let r = -CATAN_WATER_SUBDIVISIONS; r <= CATAN_WATER_SUBDIVISIONS; r++) {
      // One up- and one down-facing lattice triangle, when all three vertices are in the hex.
      triangle(key(q, r), key(q + 1, r), key(q, r + 1));
      triangle(key(q, r), key(q - 1, r), key(q, r - 1));
    }
  }
  return { vertices, indices };
}
