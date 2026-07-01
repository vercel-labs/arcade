import { BISHOP, type Color, KING, KNIGHT, onBoard, PAWN, pieceColor, pieceType, QUEEN, ROOK } from './types.ts';

// 0x88 step offsets. The 8 king offsets double as the queen's slide directions.
export const KNIGHT_OFFSETS = [33, 31, 18, 14, -33, -31, -18, -14];
export const KING_OFFSETS = [16, -16, 1, -1, 17, 15, -17, -15];
export const BISHOP_OFFSETS = [17, 15, -17, -15];
export const ROOK_OFFSETS = [16, -16, 1, -1];

// Does any piece of `byColor` attack `sq`? Used for check detection and for the
// "can't castle through check" rule. `board` is the 0x88 piece array.
export function isSquareAttacked(board: Int8Array, sq: number, byColor: Color): boolean {
  // Pawns: a `byColor` pawn marching toward higher (white) / lower (black) ranks
  // attacks `sq` from the rank behind it.
  const back = byColor === 0 ? -16 : 16;
  for (const df of [-1, 1]) {
    const ps = sq + back + df;
    if (onBoard(ps)) {
      const p = board[ps];
      if (p && pieceColor(p) === byColor && pieceType(p) === PAWN) return true;
    }
  }
  for (const off of KNIGHT_OFFSETS) {
    const s = sq + off;
    if (onBoard(s)) {
      const p = board[s];
      if (p && pieceColor(p) === byColor && pieceType(p) === KNIGHT) return true;
    }
  }
  for (const off of KING_OFFSETS) {
    const s = sq + off;
    if (onBoard(s)) {
      const p = board[s];
      if (p && pieceColor(p) === byColor && pieceType(p) === KING) return true;
    }
  }
  if (slidingHit(board, sq, BISHOP_OFFSETS, byColor, BISHOP)) return true;
  if (slidingHit(board, sq, ROOK_OFFSETS, byColor, ROOK)) return true;
  return false;
}

// Walk each ray until a piece or the edge: a hit is a `byColor` slider of the
// matching `kind` (bishop/rook) or a queen.
function slidingHit(board: Int8Array, sq: number, offsets: number[], byColor: Color, kind: number): boolean {
  for (const off of offsets) {
    let s = sq + off;
    while (onBoard(s)) {
      const p = board[s];
      if (p) {
        if (pieceColor(p) === byColor && (pieceType(p) === kind || pieceType(p) === QUEEN)) return true;
        break;
      }
      s += off;
    }
  }
  return false;
}
