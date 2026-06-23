import type { Board } from './board.ts';
import { generateLegalMoves, isInCheck } from './movegen.ts';
import {
  FILES,
  FLAG_CAPTURE,
  FLAG_CASTLE_K,
  FLAG_CASTLE_Q,
  fileOf,
  type Move,
  PAWN,
  PIECE_CHARS,
  pieceType,
  rankOf,
  squareToAlg,
} from './types.ts';

/** Long algebraic / UCI: from-square, to-square, and a promotion letter (e.g. "e7e8q"). */
export function moveToUci(m: Move): string {
  return squareToAlg(m.from) + squareToAlg(m.to) + (m.promotion ? PIECE_CHARS[m.promotion] : '');
}

// Standard Algebraic Notation, with disambiguation and check/checkmate suffix.
// `legal` is the legal move list for `b` (used for disambiguation).
export function moveToSan(b: Board, m: Move, legal: Move[]): string {
  if (m.flags & FLAG_CASTLE_K) return withSuffix(b, m, 'O-O');
  if (m.flags & FLAG_CASTLE_Q) return withSuffix(b, m, 'O-O-O');

  const type = pieceType(m.piece);
  let s = '';
  if (type === PAWN) {
    if (m.flags & FLAG_CAPTURE) s += FILES[fileOf(m.from)] + 'x';
    s += squareToAlg(m.to);
    if (m.promotion) s += '=' + PIECE_CHARS[m.promotion].toUpperCase();
  } else {
    s += PIECE_CHARS[type].toUpperCase() + disambiguate(m, legal);
    if (m.flags & FLAG_CAPTURE) s += 'x';
    s += squareToAlg(m.to);
  }
  return withSuffix(b, m, s);
}

// Minimal origin hint when another same-type piece can also reach `to`: prefer
// file, then rank, then both.
function disambiguate(m: Move, legal: Move[]): string {
  const rivals = legal.filter((x) => x.to === m.to && x.piece === m.piece && x.from !== m.from);
  if (rivals.length === 0) return '';
  if (!rivals.some((x) => fileOf(x.from) === fileOf(m.from))) return FILES[fileOf(m.from)];
  if (!rivals.some((x) => rankOf(x.from) === rankOf(m.from))) return String(rankOf(m.from) + 1);
  return FILES[fileOf(m.from)] + String(rankOf(m.from) + 1);
}

function withSuffix(b: Board, m: Move, san: string): string {
  const c = b.clone();
  c.applyMove(m);
  if (!isInCheck(c)) return san;
  return san + (generateLegalMoves(c).length === 0 ? '#' : '+');
}
