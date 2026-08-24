import type { Vec3 } from './math.ts';
import type { VertexIn } from './shader.ts';

export interface Mesh {
  vertices: VertexIn[];
  indices: number[];
  /** Incremented when mutable geometry changes so backends can refresh cached buffers. */
  readonly version?: number;
}

export interface AABB {
  min: Vec3;
  max: Vec3;
}

// Axis-aligned bounds of a mesh's vertices.
export function meshBounds(mesh: Mesh): AABB {
  const min: Vec3 = { x: Infinity, y: Infinity, z: Infinity };
  const max: Vec3 = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const v of mesh.vertices) {
    const p = v.position;
    if (p.x < min.x) min.x = p.x;
    if (p.y < min.y) min.y = p.y;
    if (p.z < min.z) min.z = p.z;
    if (p.x > max.x) max.x = p.x;
    if (p.y > max.y) max.y = p.y;
    if (p.z > max.z) max.z = p.z;
  }
  return { min, max };
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

// A camera-facing quad in the XY plane (normal +z), extent ±`h`, with uv mapped
// so the top-left of the image (u=0,v=0) lands at the top-left corner. The unit
// billboard for textured sprites — pair with a translate/scale model matrix to
// place it. White base color (textured materials sample their own color).
export function quad(h = 0.5): Mesh {
  const n: Vec3 = { x: 0, y: 0, z: 1 };
  const white: Vec3 = { x: 255, y: 255, z: 255 };
  const corners: Vec3[] = [v(-h, -h, 0), v(h, -h, 0), v(h, h, 0), v(-h, h, 0)];
  // +y is up in world but v=0 is the top image row, so the top corners get v=0.
  const uvs: [number, number][] = [
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0],
  ];
  const vertices: VertexIn[] = corners.map((p, i) => ({ position: p, normal: n, uv: uvs[i], color: white }));
  return { vertices, indices: [0, 1, 2, 0, 2, 3] };
}

// A triangular pyramid (tetrahedron): apex up, equilateral base. Exported raw
// so scenes can reuse the geometry for effects (e.g. deriving refraction from
// the live face normals) while rendering the same shape via `tetrahedron()`.
export const TETRA_VERTS: Vec3[] = [
  { x: 0, y: 0.95, z: 0 }, // 0 apex
  { x: -0.82, y: -0.45, z: 0.47 }, // 1 base
  { x: 0.82, y: -0.45, z: 0.47 }, // 2 base
  { x: 0, y: -0.45, z: -0.94 }, // 3 base
];

export const TETRA_FACES: [number, number, number][] = [
  [0, 1, 2],
  [0, 2, 3],
  [0, 3, 1],
  [1, 2, 3],
];

// Rebuild a mesh as flat-shaded triangle soup: each triangle gets its own three
// vertices sharing one geometric face normal (from positions). Lighting then
// depends only on geometry, not the source's (possibly inconsistent) stored
// normals — pair with two-sided shading so orientation doesn't matter either.
export function flatShade(mesh: Mesh): Mesh {
  const vertices: VertexIn[] = [];
  const indices: number[] = [];
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = mesh.vertices[mesh.indices[i]];
    const b = mesh.vertices[mesh.indices[i + 1]];
    const c = mesh.vertices[mesh.indices[i + 2]];
    const n = norm(cross(sub(b.position, a.position), sub(c.position, a.position)));
    const base = vertices.length;
    for (const v of [a, b, c]) vertices.push({ position: v.position, normal: n, uv: v.uv, color: v.color });
    indices.push(base, base + 1, base + 2);
  }
  return { vertices, indices };
}

export function tetrahedron(): Mesh {
  const vertices: VertexIn[] = [];
  const indices: number[] = [];
  const white: Vec3 = { x: 255, y: 255, z: 255 };
  const uvs: [number, number][] = [
    [0, 0],
    [1, 0],
    [0.5, 1],
  ];
  for (const [ia, ib, ic] of TETRA_FACES) {
    const a = TETRA_VERTS[ia];
    const b = TETRA_VERTS[ib];
    const c = TETRA_VERTS[ic];
    // Outward normal: flip if it points toward the centroid (origin).
    let n = norm(cross(sub(b, a), sub(c, a)));
    const center = { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3, z: (a.z + b.z + c.z) / 3 };
    if (n.x * center.x + n.y * center.y + n.z * center.z < 0) n = { x: -n.x, y: -n.y, z: -n.z };
    const base = vertices.length;
    vertices.push({ position: a, normal: n, uv: uvs[0], color: white });
    vertices.push({ position: b, normal: n, uv: uvs[1], color: white });
    vertices.push({ position: c, normal: n, uv: uvs[2], color: white });
    indices.push(base, base + 1, base + 2);
  }
  return { vertices, indices };
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function norm(a: Vec3): Vec3 {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}
