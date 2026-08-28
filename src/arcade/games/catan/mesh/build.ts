// Mesh assembly primitives shared by every Catan mesh module: the Build buffer, the face
// emitters (which orient winding to an "outward" hint), and small vector/colour helpers.

import {
  appendQuad,
  appendTriangle,
  BufferGeometry,
  cross3,
  normalize3,
  sineHash2,
  sub3,
  type Vec3,
} from '../../../../engine/index.ts';
export { smoothstep as smooth } from '../../../../engine/index.ts';

export type RGB = [number, number, number];
export const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const sub = sub3;
export const cross = cross3;
export const norm = normalize3;
export const hash2 = sineHash2;

export type Build = BufferGeometry;
export const build = (): Build => new BufferGeometry();

export function faceTri(m: Build, a: Vec3, b: Vec3, c: Vec3, color: RGB, outward: Vec3): void {
  appendTriangle(m, a, b, c, { color: { x: color[0], y: color[1], z: color[2] } }, outward);
}
export function faceQuad(m: Build, a: Vec3, b: Vec3, c: Vec3, d: Vec3, color: RGB, outward: Vec3): void {
  appendQuad(m, a, b, c, d, { color: { x: color[0], y: color[1], z: color[2] } }, outward);
}
// Emit a low-poly cell as ONE flat quadrilateral: both triangles share a single averaged
// normal + color, so it reads as a quad (not two triangles). Winding is irrelevant — lambert
// lights from the stored normal and cull is 'none'.
export function faceQuadFlat(m: Build, a: Vec3, b: Vec3, c: Vec3, d: Vec3, color: RGB, outward: Vec3): void {
  let n = norm(cross(sub(c, a), sub(b, d))); // normal from the diagonals
  if (n.x * outward.x + n.y * outward.y + n.z * outward.z < 0) n = { x: -n.x, y: -n.y, z: -n.z };
  const col = { x: color[0], y: color[1], z: color[2] };
  const base = m.vertices.length;
  for (const p of [a, b, c, d]) m.vertices.push({ position: { ...p }, normal: n, uv: [0, 0], color: col });
  m.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}
// Emit faces with an intentionally softened lighting normal. Useful for tiny corrugations
// whose true geometric slope would over-darken at terminal resolution.
export function faceTriWithNormal(m: Build, a: Vec3, b: Vec3, c: Vec3, color: RGB, normal: Vec3): void {
  const col = { x: color[0], y: color[1], z: color[2] };
  const n = norm(normal);
  const base = m.vertices.length;
  for (const p of [a, b, c]) m.vertices.push({ position: { ...p }, normal: n, uv: [0, 0], color: col });
  m.indices.push(base, base + 1, base + 2);
}
export function faceQuadWithNormal(m: Build, a: Vec3, b: Vec3, c: Vec3, d: Vec3, color: RGB, normal: Vec3): void {
  const col = { x: color[0], y: color[1], z: color[2] };
  const n = norm(normal);
  const base = m.vertices.length;
  for (const p of [a, b, c, d]) m.vertices.push({ position: { ...p }, normal: n, uv: [0, 0], color: col });
  m.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}
export const UP: Vec3 = { x: 0, y: 1, z: 0 };
export const DOWN: Vec3 = { x: 0, y: -1, z: 0 };
export const shade = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
