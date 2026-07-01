// Perft CLI: print the leaf-node counts per depth and compare against the canonical
// reference values. The same perft() + cases back the automated test
// (src/games/chess/perft.test.ts) — this is the human-readable view.
//
//   pnpm exec tsx src/tools/perft.ts
import { Board } from '../rules/chess/board.ts';
import { perft, PERFT_CASES } from '../rules/chess/perft.ts';

let allOk = true;
for (const { name, fen, expected } of PERFT_CASES) {
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
