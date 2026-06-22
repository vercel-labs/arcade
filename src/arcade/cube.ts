import type { Vec3 } from './math.ts';

export interface Triangle {
  /** Indices into VERTICES for the three corners. */
  a: number;
  b: number;
  c: number;
  /** Outward-facing normal in object space (used for culling + lighting). */
  normal: Vec3;
}

export const VERTICES: Vec3[] = [
  { x: -1, y: -1, z: -1 }, // 0
  { x: 1, y: -1, z: -1 }, // 1
  { x: 1, y: 1, z: -1 }, // 2
  { x: -1, y: 1, z: -1 }, // 3
  { x: -1, y: -1, z: 1 }, // 4
  { x: 1, y: -1, z: 1 }, // 5
  { x: 1, y: 1, z: 1 }, // 6
  { x: -1, y: 1, z: 1 }, // 7
];

interface Face {
  corners: [number, number, number, number];
  normal: Vec3;
}

// Each face carries an explicit outward normal so culling and lighting never
// depend on getting the triangle winding exactly right.
const FACES: Face[] = [
  { corners: [4, 5, 6, 7], normal: { x: 0, y: 0, z: 1 } }, // front  (+z)
  { corners: [1, 0, 3, 2], normal: { x: 0, y: 0, z: -1 } }, // back   (-z)
  { corners: [0, 4, 7, 3], normal: { x: -1, y: 0, z: 0 } }, // left   (-x)
  { corners: [5, 1, 2, 6], normal: { x: 1, y: 0, z: 0 } }, // right  (+x)
  { corners: [3, 7, 6, 2], normal: { x: 0, y: 1, z: 0 } }, // top    (+y)
  { corners: [0, 1, 5, 4], normal: { x: 0, y: -1, z: 0 } }, // bottom (-y)
];

export const TRIANGLES: Triangle[] = FACES.flatMap(({ corners, normal }) => {
  const [a, b, c, d] = corners;
  return [
    { a, b, c, normal },
    { a, b: c, c: d, normal },
  ];
});
