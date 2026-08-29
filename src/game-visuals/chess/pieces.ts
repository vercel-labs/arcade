import { flatShade, meshBounds, type Mesh } from '../../engine/mesh.ts';
import { parseObj } from '../../engine/obj.ts';
import { fetchObjMeshSet, type TextAssetTransport } from '../obj-assets.ts';

export const CHESS_PIECE_NAMES = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'] as const;

export type ChessPieceName = typeof CHESS_PIECE_NAMES[number];
export type ChessPieceMeshes = Record<ChessPieceName, Mesh>;
export type ChessPieceObjSources = Record<ChessPieceName, string>;

export interface ChessPieceMetrics {
  /** Uniform scale that makes the tallest imported piece `targetHeight` units tall. */
  scale: number;
  /** Suggested board-square size derived from the widest imported piece. */
  square: number;
}

export function parseChessPieceMesh(source: string): Mesh {
  return flatShade(parseObj(source));
}

/** Parse the production Wavefront assets without depending on Node or a browser. */
export function parseChessPieceMeshes(sources: ChessPieceObjSources): ChessPieceMeshes {
  return Object.fromEntries(CHESS_PIECE_NAMES.map((name) => [
    name,
    parseChessPieceMesh(sources[name]),
  ])) as unknown as ChessPieceMeshes;
}

/** The production Chess scene and focused browser scene share the same normalization. */
export function measureChessPieceMeshes(
  meshes: ChessPieceMeshes,
  targetHeight = 1.7,
): ChessPieceMetrics {
  let maxHeight = 0;
  let maxFootprint = 0;
  for (const name of CHESS_PIECE_NAMES) {
    const bounds = meshBounds(meshes[name]);
    maxHeight = Math.max(maxHeight, bounds.max.y - bounds.min.y);
    maxFootprint = Math.max(
      maxFootprint,
      bounds.max.x - bounds.min.x,
      bounds.max.z - bounds.min.z,
    );
  }
  const scale = targetHeight / (maxHeight || 1);
  return { scale, square: maxFootprint * scale * 1.25 };
}

/** Load the same OBJ set from any browser-visible asset directory. */
export async function fetchChessPieceMeshes(
  baseUrl: string,
  fetchText?: TextAssetTransport,
): Promise<ChessPieceMeshes> {
  const root = baseUrl.replace(/\/$/, '');
  const urls = Object.fromEntries(CHESS_PIECE_NAMES.map((name) => [name, `${root}/${name}.obj`])) as Record<ChessPieceName, string>;
  return fetchObjMeshSet(urls, fetchText) as Promise<ChessPieceMeshes>;
}
