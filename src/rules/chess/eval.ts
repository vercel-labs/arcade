// PeSTO ("Piece-Square Tables Only") static evaluation — a tapered evaluator that
// blends separate midgame/endgame piece-square tables by the remaining material
// (game phase). No search: this scores a single position. Despite being pure
// tables it is strong (the PeSTO engine is ~3125 Elo on CCRL Blitz), and it's
// just constant data + a 64-square scan — no deps, instant, deterministic.
//
// Source: Ronald Friederich's PeSTO / RofChade tables, via the Chess Programming
// Wiki, https://www.chessprogramming.org/PeSTO's_Evaluation_Function — values
// originally tuned with Texel's method. Wiki content is CC BY-SA 3.0 (see NOTICE.md).
//
// Tables are published in the standard layout: index 0 = a8, the first 8 numbers
// are rank 8, reading down to rank 1. Our board is 0x88 (a1 = 0, rank increases
// away from white), so white reads the table top-down — index (7-rank)*8 + file —
// and black reads the vertical mirror (rank*8 + file). The returned score is in
// centipawns from WHITE's perspective (positive = white better), independent of
// whose turn it is — what an eval bar wants.

import type { Board } from './board.ts';
import { pieceColor, pieceType, WHITE } from './types.ts';

// Midgame / endgame material values, indexed by (pieceType - 1): P N B R Q K.
const MG_VALUE = [82, 337, 365, 477, 1025, 0];
const EG_VALUE = [94, 281, 297, 512, 936, 0];

// Game-phase weight per piece type (P N B R Q K). Full phase = 24.
const PHASE_INC = [0, 1, 1, 2, 4, 0];

// prettier-ignore
const MG_PAWN = [
  0, 0, 0, 0, 0, 0, 0, 0,
  98, 134, 61, 95, 68, 126, 34, -11,
  -6, 7, 26, 31, 65, 56, 25, -20,
  -14, 13, 6, 21, 23, 12, 17, -23,
  -27, -2, -5, 12, 17, 6, 10, -25,
  -26, -4, -4, -10, 3, 3, 33, -12,
  -35, -1, -20, -23, -15, 24, 38, -22,
  0, 0, 0, 0, 0, 0, 0, 0,
];
// prettier-ignore
const EG_PAWN = [
  0, 0, 0, 0, 0, 0, 0, 0,
  178, 173, 158, 134, 147, 132, 165, 187,
  94, 100, 85, 67, 56, 53, 82, 84,
  32, 24, 13, 5, -2, 4, 17, 17,
  13, 9, -3, -7, -7, -8, 3, -1,
  4, 7, -6, 1, 0, -5, -1, -8,
  13, 8, 8, 10, 13, 0, 2, -7,
  0, 0, 0, 0, 0, 0, 0, 0,
];
// prettier-ignore
const MG_KNIGHT = [
  -167, -89, -34, -49, 61, -97, -15, -107,
  -73, -41, 72, 36, 23, 62, 7, -17,
  -47, 60, 37, 65, 84, 129, 73, 44,
  -9, 17, 19, 53, 37, 69, 18, 22,
  -13, 4, 16, 13, 28, 19, 21, -8,
  -23, -9, 12, 10, 19, 17, 25, -16,
  -29, -53, -12, -3, -1, 18, -14, -19,
  -105, -21, -58, -33, -17, -28, -19, -23,
];
// prettier-ignore
const EG_KNIGHT = [
  -58, -38, -13, -28, -31, -27, -63, -99,
  -25, -8, -25, -2, -9, -25, -24, -52,
  -24, -20, 10, 9, -1, -9, -19, -41,
  -17, 3, 22, 22, 22, 11, 8, -18,
  -18, -6, 16, 25, 16, 17, 4, -18,
  -23, -3, -1, 15, 10, -3, -20, -22,
  -42, -20, -10, -5, -2, -20, -23, -44,
  -29, -51, -23, -15, -22, -18, -50, -64,
];
// prettier-ignore
const MG_BISHOP = [
  -29, 4, -82, -37, -25, -42, 7, -8,
  -26, 16, -18, -13, 30, 59, 18, -47,
  -16, 37, 43, 40, 35, 50, 37, -2,
  -4, 5, 19, 50, 37, 37, 7, -2,
  -6, 13, 13, 26, 34, 12, 10, 4,
  0, 15, 15, 15, 14, 27, 18, 10,
  4, 15, 16, 0, 7, 21, 33, 1,
  -33, -3, -14, -21, -13, -12, -39, -21,
];
// prettier-ignore
const EG_BISHOP = [
  -14, -21, -11, -8, -7, -9, -17, -24,
  -8, -4, 7, -12, -3, -13, -4, -14,
  2, -8, 0, -1, -2, 6, 0, 4,
  -3, 9, 12, 9, 14, 10, 3, 2,
  -6, 3, 13, 19, 7, 10, -3, -9,
  -12, -3, 8, 10, 13, 3, -7, -15,
  -14, -18, -7, -1, 4, -9, -15, -27,
  -23, -9, -23, -5, -9, -16, -5, -17,
];
// prettier-ignore
const MG_ROOK = [
  32, 42, 32, 51, 63, 9, 31, 43,
  27, 32, 58, 62, 80, 67, 26, 44,
  -5, 19, 26, 36, 17, 45, 61, 16,
  -24, -11, 7, 26, 24, 35, -8, -20,
  -36, -26, -12, -1, 9, -7, 6, -23,
  -45, -25, -16, -17, 3, 0, -5, -33,
  -44, -16, -20, -9, -1, 11, -6, -71,
  -19, -13, 1, 17, 16, 7, -37, -26,
];
// prettier-ignore
const EG_ROOK = [
  13, 10, 18, 15, 12, 12, 8, 5,
  11, 13, 13, 11, -3, 3, 8, 3,
  7, 7, 7, 5, 4, -3, -5, -3,
  4, 3, 13, 1, 2, 1, -1, 2,
  3, 5, 8, 4, -5, -6, -8, -11,
  -4, 0, -5, -1, -7, -12, -8, -16,
  -6, -6, 0, 2, -9, -9, -11, -3,
  -9, 2, 3, -1, -5, -13, 4, -20,
];
// prettier-ignore
const MG_QUEEN = [
  -28, 0, 29, 12, 59, 44, 43, 45,
  -24, -39, -5, 1, -16, 57, 28, 54,
  -13, -17, 7, 8, 29, 56, 47, 57,
  -27, -27, -16, -16, -1, 17, -2, 1,
  -9, -26, -9, -10, -2, -4, 3, -3,
  -14, 2, -11, -2, -5, 2, 14, 5,
  -35, -8, 11, 2, 8, 15, -3, 1,
  -1, -18, -9, 10, -15, -25, -31, -50,
];
// prettier-ignore
const EG_QUEEN = [
  -9, 22, 22, 27, 27, 19, 10, 20,
  -17, 20, 32, 41, 58, 25, 30, 0,
  -20, 6, 9, 49, 47, 35, 19, 9,
  3, 22, 24, 45, 57, 40, 57, 36,
  -18, 28, 19, 47, 31, 34, 39, 23,
  -16, -27, 15, 6, 9, 17, 10, 5,
  -22, -23, -30, -16, -16, -23, -36, -32,
  -33, -28, -22, -43, -5, -32, -20, -41,
];
// prettier-ignore
const MG_KING = [
  -65, 23, 16, -15, -56, -34, 2, 13,
  29, -1, -20, -7, -8, -4, -38, -29,
  -9, 24, 2, -16, -20, 6, 22, -22,
  -17, -20, -12, -27, -30, -25, -14, -36,
  -49, -1, -27, -39, -46, -44, -33, -51,
  -14, -14, -22, -46, -44, -30, -15, -27,
  1, 7, -8, -64, -43, -16, 9, 8,
  -15, 36, 12, -54, 8, -28, 24, 14,
];
// prettier-ignore
const EG_KING = [
  -74, -35, -18, -18, -11, 15, 4, -17,
  -12, 17, 14, 17, 17, 38, 23, 11,
  10, 17, 23, 15, 20, 45, 44, 13,
  -8, 22, 24, 27, 26, 33, 26, 3,
  -18, -4, 21, 24, 27, 23, 9, -11,
  -19, -3, 11, 21, 23, 16, 7, -9,
  -27, -11, 4, 13, 14, 4, -5, -17,
  -53, -34, -21, -11, -28, -14, -24, -43,
];

// Indexed by (pieceType - 1): P N B R Q K.
const MG_TABLE = [MG_PAWN, MG_KNIGHT, MG_BISHOP, MG_ROOK, MG_QUEEN, MG_KING];
const EG_TABLE = [EG_PAWN, EG_KNIGHT, EG_BISHOP, EG_ROOK, EG_QUEEN, EG_KING];

// Static evaluation of `board` in centipawns from White's perspective (positive =
// White is better). Tapered: midgame and endgame scores are blended by the game
// phase (remaining material), so the score transitions smoothly into the endgame.
export function evaluate(board: Board): number {
  let mgW = 0;
  let mgB = 0;
  let egW = 0;
  let egB = 0;
  let phase = 0;

  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) continue; // off-board (0x88 layout)
    const p = board.squares[sq];
    if (!p) continue;
    const t = pieceType(p) - 1; // 0..5 → P N B R Q K
    const file = sq & 7;
    const rank = sq >> 4; // 0 = rank 1 (white's home)
    phase += PHASE_INC[t];
    if (pieceColor(p) === WHITE) {
      const i = (7 - rank) * 8 + file; // read the table top-down
      mgW += MG_VALUE[t] + MG_TABLE[t][i];
      egW += EG_VALUE[t] + EG_TABLE[t][i];
    } else {
      const i = rank * 8 + file; // vertical mirror for black
      mgB += MG_VALUE[t] + MG_TABLE[t][i];
      egB += EG_VALUE[t] + EG_TABLE[t][i];
    }
  }

  const mg = mgW - mgB;
  const eg = egW - egB;
  // Cap the phase (early promotion can exceed the starting material's 24).
  const mgPhase = phase > 24 ? 24 : phase;
  const egPhase = 24 - mgPhase;
  return Math.trunc((mg * mgPhase + eg * egPhase) / 24);
}
