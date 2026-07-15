import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Card } from '../../../rules/poker/cards.ts';
import { HoldemState } from '../../../rules/poker/holdem.ts';
import { PokerGameScene } from './poker-scene.ts';

interface GatherSnapshot {
  card: Card;
  faceUp: boolean;
}

interface SceneInternals {
  boardShown: number;
  gather: GatherSnapshot[] | null;
  muckSeat(seat: number): void;
}

const newHand = (): HoldemState => {
  let s = 0xace5;
  const rng = (): number => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  return new HoldemState({ stacks: [1000, 1000], button: 0, smallBlind: 10, bigBlind: 20, rng });
};

const newScene = (hand: HoldemState): PokerGameScene => {
  const scene = new PokerGameScene();
  scene.beginSession([
    { kind: 'human', label: 'You' },
    { kind: 'ai', label: 'Opponent', creator: 'openai' },
  ]);
  scene.beginHand(hand);
  return scene;
};

test('gather preserves the actual hole and board cards instead of substituting As', () => {
  const hand = newHand();
  const scene = newScene(hand);
  while (hand.boardCards().length < 3 && !hand.isTerminal()) hand.applyAction({ type: 'call' });

  const internal = scene as unknown as SceneInternals;
  internal.boardShown = hand.boardCards().length;
  void scene.runInterlude();

  const expected = [...hand.holeOf(0), ...hand.holeOf(1), ...hand.boardCards()];
  assert.deepEqual(internal.gather?.map(({ card }) => card), expected);
});

test('folded cards retain their identities through the muck and gather', () => {
  const hand = newHand();
  const scene = newScene(hand);
  const folded = [...hand.holeOf(0)];
  hand.applyAction({ type: 'fold' });

  const internal = scene as unknown as SceneInternals;
  internal.muckSeat(0);
  void scene.runInterlude();

  assert.deepEqual(internal.gather?.slice(-folded.length).map(({ card }) => card), folded);
});
