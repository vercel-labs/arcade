import type { Mesh, Vec3 } from '../../engine/index.ts';
import { chessSquarePosition } from './move-animation.ts';

export const CHESS_PIECE_TALLEST = 1.7;
export const CHESS_CAMERA_FOVY = (50 * Math.PI) / 180;
export const CHESS_SCENE_BACKGROUND: Vec3 = { x: 10, y: 11, z: 14 };

export function buildChessBoardMeshes(square: number): { light: Mesh; dark: Mesh; base: Mesh } {
  const light: Mesh = { vertices: [], indices: [] };
  const dark: Mesh = { vertices: [], indices: [] };
  const half = square / 2;
  for (let file = 0; file < 8; file++) for (let rank = 0; rank < 8; rank++) {
    const center = chessSquarePosition(rank * 16 + file, square, false);
    appendQuad((file + rank) % 2 === 1 ? light : dark, center.x - half, center.z - half, center.x + half, center.z + half, 0);
  }
  const base: Mesh = { vertices: [], indices: [] };
  const extent = 4 * square + square * 0.35;
  appendQuad(base, -extent, -extent, extent, extent, -0.02);
  return { light, dark, base };
}

function appendQuad(mesh: Mesh, x0: number, z0: number, x1: number, z1: number, y: number): void {
  const base = mesh.vertices.length;
  const normal: Vec3 = { x: 0, y: 1, z: 0 };
  const white: Vec3 = { x: 255, y: 255, z: 255 };
  const corners: [number, number][] = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  const uvs: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
  corners.forEach(([x, z], index) => mesh.vertices.push({ position: { x, y, z }, normal, uv: uvs[index], color: white }));
  mesh.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}
