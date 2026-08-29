import type { ChessPieceName } from './pieces.ts';

/**
 * Package-owned production model URLs. Browser bundlers emit these files beside
 * the consuming application; Node retains file: URLs for tools that want them.
 */
export const CHESS_PIECE_ASSET_URLS: Record<ChessPieceName, string> = {
  pawn: new URL('../../../assets/chess_blender/pawn.obj', import.meta.url).toString(),
  knight: new URL('../../../assets/chess_blender/knight.obj', import.meta.url).toString(),
  bishop: new URL('../../../assets/chess_blender/bishop.obj', import.meta.url).toString(),
  rook: new URL('../../../assets/chess_blender/rook.obj', import.meta.url).toString(),
  queen: new URL('../../../assets/chess_blender/queen.obj', import.meta.url).toString(),
  king: new URL('../../../assets/chess_blender/king.obj', import.meta.url).toString(),
};
