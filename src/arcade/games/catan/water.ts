// The board's sea: one finite, flat-top hexagon beneath the 19 land tiles. A triangular lattice
// gives the water material enough vertices to form gentle physical swells; the substantially
// finer ripple detail remains in the material so this CPU renderer does not need a huge mesh.

import type { Mesh, Vec3, VertexIn } from '../../../engine/index.ts';

// Standard-compatible cardboard measurements put a terrain tile at about 91.5 mm from
// point to point and 79.25 mm from flat to flat, with the assembled base board around
// 480 x 440 mm. Expressing those outer dimensions in tile units makes the commercial sea
// frame slightly taller than a mathematically regular hexagon.
export const CATAN_WATER_RADIUS_X = 480 / 91.5; // 5.246 tile circumdiameters across
export const CATAN_WATER_RADIUS_Z = 440 / 79.25; // 5.552 tile flat-heights tall
export const CATAN_WATER_Y = -0.19; // just below the tile walls (which bottom out at -0.16)
export const CATAN_WATER_SUBDIVISIONS = 20;

const UP: Vec3 = { x: 0, y: 1, z: 0 };
const COLOR: Vec3 = { x: 255, y: 255, z: 255 }; // material supplies the actual palette

export function catanWaterMesh(): Mesh {
  const vertices: VertexIn[] = [];
  const byCoord = new Map<string, number>();
  const stepX = CATAN_WATER_RADIUS_X / CATAN_WATER_SUBDIVISIONS;
  const stepZ = CATAN_WATER_RADIUS_Z / CATAN_WATER_SUBDIVISIONS;
  const key = (q: number, r: number): string => `${q},${r}`;

  // Axial coordinates describe a regular triangular lattice clipped to a flat-top hex.
  for (let q = -CATAN_WATER_SUBDIVISIONS; q <= CATAN_WATER_SUBDIVISIONS; q++) {
    const rMin = Math.max(-CATAN_WATER_SUBDIVISIONS, -q - CATAN_WATER_SUBDIVISIONS);
    const rMax = Math.min(CATAN_WATER_SUBDIVISIONS, -q + CATAN_WATER_SUBDIVISIONS);
    for (let r = rMin; r <= rMax; r++) {
      const x = stepX * (q + r / 2);
      const z = stepZ * (Math.sqrt(3) / 2) * r;
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
    if (ai !== undefined && bi !== undefined && ci !== undefined) indices.push(ai, bi, ci);
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
