import assert from 'node:assert/strict';
import test from 'node:test';
import { ChessState } from '../../../rules/chess/chess.ts';
import type { Move } from '../../../rules/chess/types.ts';
import type { Player } from '../../player.ts';
import { CHESS_DEFAULT_MAX_PLIES, runHeadlessChessMatch } from './chess-session.ts';

const firstLegal = (name: string): Player<Move> => ({
  name,
  async chooseAction(state) {
    const action = state.legalActions()[0];
    if (!action) throw new Error('expected a legal chess action');
    return { action };
  },
});

test('headless chess uses the public default bound and supports explicit limits', async () => {
  assert.equal(CHESS_DEFAULT_MAX_PLIES, 300);
  const result = await runHeadlessChessMatch(
    new ChessState(),
    [firstLegal('white'), firstLegal('black')],
    { maxPlies: 4 },
  );
  assert.equal(result.status, 'bounded');
  assert.equal(result.plies, 4);
});

test('chess harness requires exactly two players', async () => {
  await assert.rejects(
    runHeadlessChessMatch(new ChessState(), [firstLegal('only')]),
    /exactly two players/,
  );
});
