import { BISHOP_OFFSETS, isSquareAttacked, KING_OFFSETS, KNIGHT_OFFSETS, ROOK_OFFSETS } from './attacks.ts';
import type { Board } from './board.ts';
import {
  BISHOP,
  CASTLE_BK,
  CASTLE_BQ,
  CASTLE_WK,
  CASTLE_WQ,
  type Color,
  FLAG_CAPTURE,
  FLAG_CASTLE_K,
  FLAG_CASTLE_Q,
  FLAG_DOUBLE,
  FLAG_EP,
  FLAG_PROMO,
  KING,
  KNIGHT,
  type Move,
  onBoard,
  PAWN,
  piece,
  pieceColor,
  type PieceType,
  pieceType,
  QUEEN,
  rankOf,
  ROOK,
  square,
  WHITE,
} from './types.ts';

const PROMO_TYPES: PieceType[] = [QUEEN, ROOK, BISHOP, KNIGHT];

/** Is the side to move currently in check? */
export function isInCheck(b: Board): boolean {
  return isSquareAttacked(b.squares, b.kingSquare(b.turn), (b.turn ^ 1) as Color);
}

/** Fully legal moves for the side to move. */
export function generateLegalMoves(b: Board): Move[] {
  const us = b.turn;
  const them = (us ^ 1) as Color;
  const legal: Move[] = [];
  for (const m of generatePseudoLegal(b)) {
    const c = b.clone();
    c.applyMove(m);
    // The move is legal iff it doesn't leave our own king attacked.
    if (!isSquareAttacked(c.squares, c.kingSquare(us), them)) legal.push(m);
  }
  return legal;
}

// Pseudo-legal: obeys piece movement but may leave the king in check (filtered
// above). Castling is fully validated here, since the "passes through check"
// rule isn't caught by the destination-only check.
export function generatePseudoLegal(b: Board): Move[] {
  const sq = b.squares;
  const us = b.turn;
  const them = (us ^ 1) as Color;
  const moves: Move[] = [];
  const push = (from: number, to: number, flags: number, promotion = 0): void => {
    const captured = flags & FLAG_EP ? piece(them, PAWN) : sq[to];
    moves.push({ from, to, piece: sq[from], captured, promotion, flags });
  };

  for (let from = 0; from < 128; from++) {
    if (from & 0x88) continue;
    const p = sq[from];
    if (!p || pieceColor(p) !== us) continue;
    const type = pieceType(p);

    if (type === PAWN) {
      const dir = us === WHITE ? 16 : -16;
      const startRank = us === WHITE ? 1 : 6;
      const lastRank = us === WHITE ? 7 : 0;
      const one = from + dir;
      if (onBoard(one) && !sq[one]) {
        if (rankOf(one) === lastRank) for (const pr of PROMO_TYPES) push(from, one, FLAG_PROMO, pr);
        else {
          push(from, one, 0);
          const two = from + 2 * dir;
          if (rankOf(from) === startRank && !sq[two]) push(from, two, FLAG_DOUBLE);
        }
      }
      for (const df of [-1, 1]) {
        const to = from + dir + df;
        if (!onBoard(to)) continue;
        if (sq[to] && pieceColor(sq[to]) === them) {
          if (rankOf(to) === lastRank) for (const pr of PROMO_TYPES) push(from, to, FLAG_PROMO | FLAG_CAPTURE, pr);
          else push(from, to, FLAG_CAPTURE);
        } else if (to === b.ep) {
          push(from, to, FLAG_EP | FLAG_CAPTURE);
        }
      }
    } else if (type === KNIGHT) {
      stepMoves(sq, from, KNIGHT_OFFSETS, them, push);
    } else if (type === KING) {
      stepMoves(sq, from, KING_OFFSETS, them, push);
      generateCastling(b, push);
    } else {
      const offsets = type === BISHOP ? BISHOP_OFFSETS : type === ROOK ? ROOK_OFFSETS : KING_OFFSETS;
      for (const off of offsets) {
        let to = from + off;
        while (onBoard(to)) {
          if (!sq[to]) {
            push(from, to, 0);
          } else {
            if (pieceColor(sq[to]) === them) push(from, to, FLAG_CAPTURE);
            break;
          }
          to += off;
        }
      }
    }
  }
  return moves;
}

// Single-step pieces (knight, king): one move per offset onto an empty/enemy square.
function stepMoves(
  sq: Int8Array,
  from: number,
  offsets: number[],
  them: Color,
  push: (from: number, to: number, flags: number) => void,
): void {
  for (const off of offsets) {
    const to = from + off;
    if (!onBoard(to)) continue;
    if (!sq[to]) push(from, to, 0);
    else if (pieceColor(sq[to]) === them) push(from, to, FLAG_CAPTURE);
  }
}

function generateCastling(b: Board, push: (from: number, to: number, flags: number) => void): void {
  const us = b.turn;
  const them = (us ^ 1) as Color;
  const sq = b.squares;
  const king = us === WHITE ? square(4, 0) : square(4, 7);
  if (isSquareAttacked(sq, king, them)) return; // can't castle out of check

  const rank = us === WHITE ? 0 : 7;
  const kRight = us === WHITE ? CASTLE_WK : CASTLE_BK;
  const qRight = us === WHITE ? CASTLE_WQ : CASTLE_BQ;
  const rook = piece(us, ROOK);

  // Kingside: f,g empty and unattacked; rook home on h.
  const f = square(5, rank);
  const g = square(6, rank);
  if (b.castling & kRight && !sq[f] && !sq[g] && sq[square(7, rank)] === rook && !isSquareAttacked(sq, f, them) && !isSquareAttacked(sq, g, them)) {
    push(king, g, FLAG_CASTLE_K);
  }
  // Queenside: b,c,d empty; c,d unattacked; rook home on a.
  const d = square(3, rank);
  const c = square(2, rank);
  const bSq = square(1, rank);
  if (b.castling & qRight && !sq[bSq] && !sq[c] && !sq[d] && sq[square(0, rank)] === rook && !isSquareAttacked(sq, c, them) && !isSquareAttacked(sq, d, them)) {
    push(king, c, FLAG_CASTLE_Q);
  }
}
