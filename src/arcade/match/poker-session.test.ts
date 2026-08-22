import assert from 'node:assert/strict';
import test from 'node:test';
import type { Player } from '../../ai/player.ts';
import type { GameState } from '../../rules/game.ts';
import type { PokerAction } from '../../rules/poker/holdem.ts';
import { runPokerSession } from './poker-session.ts';

class FirstLegalPlayer implements Player<PokerAction> {
  constructor(readonly name: string) {}
  async chooseAction(state: GameState<PokerAction>) {
    const action = state.legalActions()[0];
    if (!action) throw new Error('expected a legal poker action');
    return { action };
  }
}

test('headless poker session carries a real hand into local canonical records', async () => {
  const result = await runPokerSession({
    models: ['model-a', 'model-b'],
    players: [new FirstLegalPlayer('a'), new FirstLegalPlayer('b')],
    maxHands: 1,
    maxActions: 20,
    rng: () => 0.5,
  });
  assert.equal(result.status, 'bounded');
  assert.equal(result.handCount, 1);
  assert.equal(result.handRecords.length, 1);
  assert.equal(result.handRecords[0].status, 'completed');
  assert.equal(result.matchRecord.status, 'abandoned');
  assert.equal(result.finalStacks.reduce((sum, stack) => sum + stack, 0), 2_000);
});
