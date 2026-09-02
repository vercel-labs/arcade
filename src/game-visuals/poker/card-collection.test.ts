import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mulberry32 } from '../../engine/random.ts';
import { parseCard } from '../../rules/poker/cards.ts';
import { POKER_DECK_POSITION, pokerHoleCardPose } from './layout.ts';
import { POKER_GATHER_STEP, POKER_MUCK_STEP, createPokerGatherCard, createPokerMuckCards, pokerGatherCardPose, pokerMuckCardPose } from './card-collection.ts';

const cards = [parseCard('8c')!, parseCard('8d')!];

test('production muck moves real cards from their seat into a seeded scatter pile', () => {
  const muck = createPokerMuckCards(cards, 1, 5, 0, mulberry32(0x1053e));
  assert.deepEqual(muck.map(({ card }) => card), cards);
  const start = pokerMuckCardPose(muck[0], 0);
  const seat = pokerHoleCardPose(1, 0, 5);
  assert.deepEqual({ x: start.x, z: start.z, yaw: start.yaw }, seat);
  const end = pokerMuckCardPose(muck[0], 1);
  assert.ok(Math.hypot(end.x - 1.7, end.z - POKER_DECK_POSITION.z) <= 0.23);
  assert.equal(POKER_MUCK_STEP, 0.42);
});

test('production gather preserves identity and lands face-down in the live deck', () => {
  const gather = createPokerGatherCard(cards[0], 2, 3, 1.2, true, 3);
  const start = pokerGatherCardPose(gather, 3, 0, 0.4);
  assert.deepEqual({ x: start.x, z: start.z }, { x: 2, z: 3 });
  const end = pokerGatherCardPose(gather, 3, gather.delay + POKER_GATHER_STEP, 0.4);
  assert.equal(end.x, POKER_DECK_POSITION.x);
  assert.ok(Math.abs(end.z - POKER_DECK_POSITION.z) < 1e-12);
  assert.equal(end.rx, Math.PI / 2);
  assert.equal(gather.card, cards[0]);
});
