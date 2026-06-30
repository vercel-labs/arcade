// Correctness test for the chess move generator: leaf-node counts must match the
// canonical perft reference values. Shares perft() + the cases with the CLI tool
// (src/tools/perft.ts), so the proof and the dev script never drift.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Board } from './board.ts';
import { perft, PERFT_CASES } from './perft.ts';

for (const { name, fen, expected } of PERFT_CASES) {
  expected.forEach((want, i) => {
    const depth = i + 1;
    test(`perft ${name} depth ${depth}`, () => {
      assert.equal(perft(Board.fromFEN(fen), depth), want);
    });
  });
}
