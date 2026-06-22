import type { Vec3 } from './math.ts';
import type { VertexIn } from './shader.ts';

export interface Mesh {
  vertices: VertexIn[];
  indices: number[];
}

interface Face {
  corners: [Vec3, Vec3, Vec3, Vec3];
  normal: Vec3;
  color: Vec3;
}

// A unit cube with per-face normals and colors (extent ±`h` on each axis).
export function cube(h = 1): Mesh {
  const faces: Face[] = [
    {
      corners: [v(-h, -h, h), v(h, -h, h), v(h, h, h), v(-h, h, h)],
      normal: { x: 0, y: 0, z: 1 },
      color: { x: 240, y: 80, z: 90 },
    },
    {
      corners: [v(h, -h, -h), v(-h, -h, -h), v(-h, h, -h), v(h, h, -h)],
      normal: { x: 0, y: 0, z: -1 },
      color: { x: 90, y: 200, z: 120 },
    },
    {
      corners: [v(h, -h, h), v(h, -h, -h), v(h, h, -h), v(h, h, h)],
      normal: { x: 1, y: 0, z: 0 },
      color: { x: 240, y: 200, z: 80 },
    },
    {
      corners: [v(-h, -h, -h), v(-h, -h, h), v(-h, h, h), v(-h, h, -h)],
      normal: { x: -1, y: 0, z: 0 },
      color: { x: 80, y: 150, z: 240 },
    },
    {
      corners: [v(-h, h, h), v(h, h, h), v(h, h, -h), v(-h, h, -h)],
      normal: { x: 0, y: 1, z: 0 },
      color: { x: 200, y: 110, z: 240 },
    },
    {
      corners: [v(-h, -h, -h), v(h, -h, -h), v(h, -h, h), v(-h, -h, h)],
      normal: { x: 0, y: -1, z: 0 },
      color: { x: 80, y: 220, z: 220 },
    },
  ];

  const vertices: VertexIn[] = [];
  const indices: number[] = [];
  const uvs: [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  for (const face of faces) {
    const base = vertices.length;
    for (let i = 0; i < 4; i++) {
      vertices.push({ position: face.corners[i], normal: face.normal, uv: uvs[i], color: face.color });
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { vertices, indices };
}

function v(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}
