// Perft: count the leaf nodes of the move tree to a given depth. Matching the
// well-known reference counts is the gold-standard correctness test for a chess
// move generator (it exercises castling, en passant, promotion, and pins).
//
//   pnpm exec tsx src/tools/perft.ts
import { Board } from '../games/chess/board.ts';
import { generateLegalMoves } from '../games/chess/movegen.ts';

function perft(b: Board, depth: number): number {
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

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
// "Kiwipete" — a standard position dense with castling/en passant/promotion.
const KIWIPETE = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';

const cases: { name: string; fen: string; expected: number[] }[] = [
  { name: 'start', fen: START, expected: [20, 400, 8902, 197281] },
  { name: 'kiwipete', fen: KIWIPETE, expected: [48, 2039, 97862] },
];

let allOk = true;
for (const { name, fen, expected } of cases) {
  expected.forEach((want, i) => {
    const depth = i + 1;
    const got = perft(Board.fromFEN(fen), depth);
    const ok = got === want;
    allOk &&= ok;
    console.log(`${name.padEnd(9)} depth ${depth}: ${String(got).padStart(7)}  ${ok ? 'OK' : `FAIL (expected ${want})`}`);
  });
}
console.log(allOk ? '\nperft: all positions match ✓' : '\nperft: MISMATCH ✗');
process.exit(allOk ? 0 : 1);
