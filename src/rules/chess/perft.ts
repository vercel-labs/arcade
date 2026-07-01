// Perft: count the leaf nodes of the move tree to a given depth. Matching the
// well-known reference counts is the gold-standard correctness test for a chess
// move generator (it exercises castling, en passant, promotion, and pins).
import { Board } from './board.ts';
import { generateLegalMoves } from './movegen.ts';

export function perft(b: Board, depth: number): number {
  const moves = generateLegalMoves(b);
  if (depth <= 1) return moves.length;
  let nodes = 0;
  for (const m of moves) {
    const c = b.clone();
    c.applyMove(m);
    nodes += perft(c, depth - 1);
  }
  return nodes;
}

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
// "Kiwipete" — a standard position dense with castling/en passant/promotion.
export const KIWIPETE_FEN = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';

// Reference leaf-node counts by depth (index 0 = depth 1). The canonical perft values.
export const PERFT_CASES: { name: string; fen: string; expected: number[] }[] = [
  { name: 'start', fen: START_FEN, expected: [20, 400, 8902, 197281] },
  { name: 'kiwipete', fen: KIWIPETE_FEN, expected: [48, 2039, 97862] },
];
