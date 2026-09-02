import assert from 'node:assert/strict';
import test from 'node:test';
import type { Player } from '../../player.ts';
import type { GameState } from '../../../rules/game.ts';
import type { PokerAction } from '../../../rules/poker/holdem.ts';
import { runPokerSession } from './poker-session.ts';

class FirstLegalPlayer implements Player<PokerAction> {
  constructor(readonly name: string) {}
  async chooseAction(state: GameState<PokerAction>) {
    const action = state.legalActions()[0];
    if (!action) throw new Error('expected a legal poker action');
    return { action };
  }
}

class CommunicatingFirstLegalPlayer implements Player<PokerAction> {
  constructor(readonly name: string) {}
  async chooseAction(state: GameState<PokerAction>) {
    const action = state.legalActions()[0];
    if (!action) throw new Error('expected a legal poker action');
    return {
      action,
      communication: { mode: 'speak', intent: 'negotiate', text: 'Let us make this interesting.' } as const,
    };
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

test('headless poker uses the shared blind level before dealing hand 16', async () => {
  const events: Array<{ type: string; hand: number; bigBlind?: number }> = [];
  const result = await runPokerSession({
    models: ['model-a', 'model-b'],
    players: [new FirstLegalPlayer('a'), new FirstLegalPlayer('b')],
    maxHands: 16,
    maxActions: 30,
    rng: () => 0.5,
    onEvent: (event) => events.push({ type: event.type, hand: event.hand, bigBlind: event.blinds?.bigBlind }),
  });

  assert.equal(result.handRecords[14].bigBlind, 20);
  assert.equal(result.handRecords[15].smallBlind, 15);
  assert.equal(result.handRecords[15].bigBlind, 30);
  assert.deepEqual(result.blindProgression.map(({ level, hand, smallBlind, bigBlind }) => ({ level, hand, smallBlind, bigBlind })), [
    { level: 1, hand: 1, smallBlind: 10, bigBlind: 20 },
    { level: 2, hand: 16, smallBlind: 15, bigBlind: 30 },
  ]);
  assert.deepEqual(
    events.filter((event) => event.type === 'blind_level_changed'),
    [{ type: 'blind_level_changed', hand: 1, bigBlind: 20 }, { type: 'blind_level_changed', hand: 16, bigBlind: 30 }],
  );
  assert.deepEqual(result.matchRecord.details.blindLevels, [
    { level: 1, startsAtHand: 1, smallBlind: 10, bigBlind: 20 },
    { level: 2, startsAtHand: 16, smallBlind: 15, bigBlind: 30 },
  ]);
});

test('headless poker ambient mode records host-gated communication decisions', async () => {
  const events: string[] = [];
  const result = await runPokerSession({
    models: ['model-a', 'model-b'],
    players: [new CommunicatingFirstLegalPlayer('a'), new CommunicatingFirstLegalPlayer('b')],
    communicationMode: 'ambient',
    maxHands: 1,
    maxActions: 20,
    rng: () => 0.5,
    onEvent: (event) => events.push(event.type),
  });
  assert.ok(events.includes('communication_decision'));
  assert.ok((result.communication?.decisions ?? 0) > 0);
});
