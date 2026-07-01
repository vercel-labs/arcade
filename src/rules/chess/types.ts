// Chess primitives. Squares use the classic 0x88 layout: index = rank*16 + file,
// so a square is on the board iff (index & 0x88) === 0, and ray/step moves that
// wrap off an edge are caught by a single bit test. Rank 0 is white's home rank
// (a1 = 0, h1 = 7, a8 = 112, h8 = 119).

export const WHITE = 0;
export const BLACK = 1;
export type Color = 0 | 1;

export const EMPTY = 0;
export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;
export type PieceType = 1 | 2 | 3 | 4 | 5 | 6;

// A piece is encoded as (color << 3) | type: white pawn..king = 1..6, black = 9..14.
export const piece = (color: Color, type: PieceType): number => (color << 3) | type;
export const pieceColor = (p: number): Color => ((p >> 3) & 1) as Color;
export const pieceType = (p: number): number => p & 7;

// Castling-rights flags.
export const CASTLE_WK = 1;
export const CASTLE_WQ = 2;
export const CASTLE_BK = 4;
export const CASTLE_BQ = 8;

// Move flags.
export const FLAG_CAPTURE = 1;
export const FLAG_EP = 2; // en passant capture
export const FLAG_CASTLE_K = 4;
export const FLAG_CASTLE_Q = 8;
export const FLAG_DOUBLE = 16; // pawn two-square push (sets the ep square)
export const FLAG_PROMO = 32;

export interface Move {
  from: number; // 0x88 square
  to: number; // 0x88 square
  piece: number; // moving piece (encoded)
  captured: number; // captured piece (encoded) or EMPTY
  promotion: number; // promotion PieceType (2..5) or 0
  flags: number;
}

export const fileOf = (sq: number): number => sq & 7;
export const rankOf = (sq: number): number => sq >> 4;
export const square = (file: number, rank: number): number => rank * 16 + file;
export const onBoard = (sq: number): boolean => (sq & 0x88) === 0;
/** 0 = dark square, 1 = light square. */
export const squareColor = (sq: number): number => (fileOf(sq) + rankOf(sq)) & 1;

export const FILES = 'abcdefgh';
export const PIECE_CHARS = '.pnbrqk'; // index by pieceType

export function squareToAlg(sq: number): string {
  return FILES[fileOf(sq)] + String(rankOf(sq) + 1);
}

export function algToSquare(alg: string): number {
  return square(alg.charCodeAt(0) - 97, alg.charCodeAt(1) - 49);
}
