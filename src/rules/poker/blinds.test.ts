import assert from 'node:assert/strict';
import test from 'node:test';
import { pokerBlindState, pokerTournamentContext } from './blinds.ts';

test('poker blinds start at 10/20 and remain there for 15 completed hands', () => {
  assert.deepEqual(pokerBlindState(0), {
    smallBlind: 10, bigBlind: 20, level: 1, hand: 1, completedHands: 0,
    handsPerLevel: 15, handsUntilNextLevel: 15,
  });
  assert.equal(pokerBlindState(14).bigBlind, 20);
  assert.equal(pokerBlindState(14).handsUntilNextLevel, 1);
});

test('poker blinds increase before hand 16 and progress through several levels', () => {
  assert.deepEqual(pokerBlindState(15), {
    smallBlind: 15, bigBlind: 30, level: 2, hand: 16, completedHands: 15,
    handsPerLevel: 15, handsUntilNextLevel: 15,
  });
  assert.deepEqual(
    [0, 15, 30, 45, 60, 75].map((hands) => [pokerBlindState(hands).smallBlind, pokerBlindState(hands).bigBlind]),
    [[10, 20], [15, 30], [20, 40], [25, 50], [40, 80], [50, 100]],
  );
});

test('poker blinds continue with rounded increases beyond the explicit ladder', () => {
  assert.deepEqual([150, 165, 180, 195].map((hands) => {
    const state = pokerBlindState(hands);
    return [state.smallBlind, state.bigBlind];
  }), [[300, 600], [400, 800], [500, 1000], [750, 1500]]);
});

test('poker blind presets can override initial blinds and hands per level', () => {
  const first = pokerBlindState(0, { initialSmallBlind: 5, initialBigBlind: 10, handsPerLevel: 3 });
  const second = pokerBlindState(3, { initialSmallBlind: 5, initialBigBlind: 10, handsPerLevel: 3 });
  assert.deepEqual([first.smallBlind, first.bigBlind, first.handsUntilNextLevel], [5, 10, 3]);
  assert.deepEqual([second.smallBlind, second.bigBlind, second.level], [8, 15, 2]);
});

test('poker model context includes chips, big blinds, hand, level, and countdown', () => {
  assert.equal(
    pokerTournamentContext(pokerBlindState(15), 450),
    'Tournament hand 16, blind level 2: 15/30. Your stack: 450 chips (15 big blinds). 15 hands until the next blind increase.',
  );
});
