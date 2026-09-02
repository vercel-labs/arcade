import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Card } from '../../../rules/poker/cards.ts';
import { HoldemState } from '../../../rules/poker/holdem.ts';
import { PokerGameScene } from './poker-scene.ts';
import { CARD_H, CARD_W } from './card-render.ts';
import { chipAmount, chipPileHalfExtent, playerColumns, potColumns, type ChipColumn } from '../../../game-visuals/poker/chips.ts';
import { TABLE_RADIUS } from './table.ts';

interface GatherSnapshot {
  card: Card;
  faceUp: boolean;
}

interface SceneInternals {
  boardShown: number;
  chipStacks: ChipColumn[][];
  betPlace: { seat: number; amount: number; cols: ChipColumn[]; t: number } | null;
  chipAward: { awards: { seat: number; amount: number; cols: ChipColumn[] }[]; t: number } | null;
  gather: GatherSnapshot[] | null;
  gatherT: number;
  shuffleClock: number;
  deckTurnClock: number;
  advanceInterlude(dt: number): void;
  betCenter(seat: number, cols: ChipColumn[], seed: number): { x: number; z: number };
  stackCenter(seat: number, cols: ChipColumn[]): { x: number; z: number };
  seatAngle(seat: number): number;
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

test('the pot reaches its winner before card gathering starts', () => {
  const hand = newHand();
  const scene = newScene(hand);
  hand.applyAction({ type: 'fold' });

  const internal = scene as unknown as SceneInternals;
  void scene.runInterlude();

  assert.deepEqual(
    internal.chipAward?.awards.map(({ seat, amount }) => ({ seat, amount })),
    hand.awards(),
  );
  assert.equal(chipAmount(internal.chipAward?.awards[0]?.cols ?? []), hand.awards()[0].amount);
  assert.equal(scene.tableView()?.pot, 0, 'the delivered pot stays gone for the interlude');
  internal.advanceInterlude(1);
  assert.equal(internal.chipAward, null);
  assert.equal(internal.gatherT, 0, 'the award flight gets its own beat before gathering');
  internal.advanceInterlude(0.1);
  assert.equal(internal.gatherT, 0.1);
  assert.equal(scene.tableView()?.pot, 0, 'the pot does not reappear after the flight');
});

test('a scene all-in moves the owned towers without changing their denominations', () => {
  const hand = newHand();
  const scene = newScene(hand);
  const internal = scene as unknown as SceneInternals;
  const actor = hand.toActSeat();
  const owned = internal.chipStacks[actor].map((column) => ({ ...column }));

  void scene.playMove({ type: 'allin' });
  assert.deepEqual(internal.chipStacks[actor], []);
  assert.deepEqual(internal.betPlace?.cols, owned);
  assert.equal(internal.betPlace?.amount, chipAmount(owned));
});

test('the settled bridge gets a separate smooth-turn phase before the next hand', async () => {
  const hand = newHand();
  const scene = newScene(hand);
  hand.applyAction({ type: 'fold' });
  const internal = scene as unknown as SceneInternals;
  const complete = scene.runInterlude();

  internal.advanceInterlude(1); // award
  internal.advanceInterlude(10); // gather
  internal.advanceInterlude(20); // both unchanged riffle/bridge cycles
  assert.equal(internal.shuffleClock, -1);
  assert.equal(internal.deckTurnClock, 0, 'turn starts only after the final shuffle rest');

  internal.advanceInterlude(0.225);
  assert.equal(internal.deckTurnClock, 0.225);
  internal.advanceInterlude(0.225);
  await complete;
  assert.equal(internal.deckTurnClock, 0.45, 'interlude resolves at the live-deck orientation');
});

test('a side-seat flop bet moves clear of the dealt community cards', () => {
  const scene = new PokerGameScene();
  scene.beginSession([
    { kind: 'human', label: 'You' },
    { kind: 'ai', label: 'Right' },
    { kind: 'ai', label: 'Across' },
    { kind: 'ai', label: 'Left' },
  ]);
  const internal = scene as unknown as SceneInternals;
  internal.boardShown = 3;
  const cols = potColumns(140);

  const left = internal.betCenter(3, cols, 103);
  assert.ok(left.z > 0.5 + CARD_H / 2, 'left-seat chips sit beyond the board card edge');

  const across = internal.betCenter(2, cols, 102);
  assert.ok(Math.abs(across.z + 2.4) < 1e-12, 'an already-clear bet keeps its original spot');
});

test('carried chips sit close to cards and rail without crossing either', () => {
  const scene = new PokerGameScene();
  scene.beginSession([
    { kind: 'human', label: 'You' },
    { kind: 'ai', label: 'Right' },
    { kind: 'ai', label: 'Across' },
    { kind: 'ai', label: 'Left' },
  ]);
  const internal = scene as unknown as SceneInternals;
  const cardTangentEdge = (0.62 + 0.5) * CARD_W;

  for (const amount of [990, 10_000]) {
    const cols = playerColumns(amount);
    for (let seat = 0; seat < 4; seat++) {
      const center = internal.stackCenter(seat, cols);
      const ext = chipPileHalfExtent(cols, seat);
      const angle = internal.seatAngle(seat);
      const radial = { x: Math.sin(angle), z: Math.cos(angle) };
      const tangent = { x: Math.cos(angle), z: -Math.sin(angle) };
      const tangentOffset = center.x * tangent.x + center.z * tangent.z;
      assert.ok(tangentOffset - ext.perp > cardTangentEdge, 'pile footprint must clear both hole cards');

      for (const radialSign of [-1, 1]) {
        for (const tangentSign of [-1, 1]) {
          const x = center.x + radial.x * ext.axis * radialSign + tangent.x * ext.perp * tangentSign;
          const z = center.z + radial.z * ext.axis * radialSign + tangent.z * ext.perp * tangentSign;
          assert.ok(Math.hypot(x, z) <= TABLE_RADIUS - 0.419, 'pile footprint must remain inside the felt');
        }
      }
    }
  }
});
