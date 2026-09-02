import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ActiveSceneLoopClock } from './scene-loop.ts';
import { CHESS_LOOP_SECONDS, EVERGREEN_GAME_MOVES, POKER_CINEMATIC_HANDS, POKER_LOOP_SECONDS, pokerLoopState } from './scripted-games.ts';
import { ChessState } from '../rules/chess/chess.ts';
import { chipAmount, mergeChipColumns, playerColumns, takeChipColumns } from '../game-visuals/poker/chips.ts';

test('active scene clock starts on entry, loops, and resets after exit', () => {
  const clock = new ActiveSceneLoopClock();
  assert.equal(clock.sample(50, false, 10).phase, 0);
  assert.equal(clock.sample(50, true, 10).phase, 0);
  assert.equal(clock.sample(56, true, 10).phase, 0.6);
  assert.deepEqual(clock.sample(71, true, 10), { elapsed: 1, phase: 0.1, iteration: 2 });
  clock.sample(72, false, 10);
  assert.equal(clock.sample(90, true, 10).phase, 0);
});

test('Evergreen sequence is a legal complete game with a loop hold', () => {
  const game = new ChessState();
  for (const notation of EVERGREEN_GAME_MOVES) {
    const move = game.actionFromString(notation);
    assert.ok(move, notation);
    game.applyAction(move);
  }
  assert.deepEqual(game.result(), { winner: 0, reason: 'checkmate' });
  assert.ok(CHESS_LOOP_SECONDS > 20);
});

test('Poker autopilot reaches every street and folds deterministic seats', () => {
  assert.equal(pokerLoopState(0).shuffle, 0);
  assert.equal(pokerLoopState(1.5 / POKER_LOOP_SECONDS).shuffle, 0.5);
  assert.equal(pokerLoopState(3 / POKER_LOOP_SECONDS).shuffle, 1);
  assert.equal(pokerLoopState(3 / POKER_LOOP_SECONDS).deal, 0);
  assert.equal(pokerLoopState(firstShiftedPhase(0.6)).flop, 1);
  assert.equal(pokerLoopState(firstShiftedPhase(0.72)).turn, 1);
  assert.equal(pokerLoopState(firstShiftedPhase(0.86)).river, 1);
  assert.deepEqual(pokerLoopState(firstShiftedPhase(0.8)).foldedSeats, [3, 1]);
  assert.equal(pokerLoopState(firstShiftedPhase(0.96)).showdown, 1);
  assert.ok(pokerLoopState(firstShiftedPhase(0.9)).gatherElapsed !== null);
});

test('only the first Poker entry shuffles once; subsequent hands shuffle twice', () => {
  assert.equal(pokerLoopState(0, 0).shuffleCycles, 1);
  assert.equal(pokerLoopState(0, 1).shuffleCycles, 2);
  assert.equal(pokerLoopState(3 / POKER_LOOP_SECONDS, 0).shuffle, 1);
  assert.equal(pokerLoopState(3 / POKER_LOOP_SECONDS, 1).shuffle, 0.5);
  assert.equal(pokerLoopState(6 / POKER_LOOP_SECONDS, 1).shuffle, 1);
  assert.ok(pokerLoopState(4 / POKER_LOOP_SECONDS, 0).deal > 0);
  assert.equal(pokerLoopState(4 / POKER_LOOP_SECONDS, 1).deal, 0);
});

test('Poker seats use varied production peek and full-lift choreography', () => {
  const samples = Array.from({ length: 201 }, (_, index) => pokerLoopState(index / 200).seatPeeks);
  for (let seat = 0; seat < 5; seat++) {
    assert.ok(samples.some((peeks) => peeks[seat].some((reveal) => reveal > 0)), `seat ${seat} never looks at its cards`);
  }
  assert.ok(samples.every((peeks) => peeks[1][1] === 0), 'one player should inspect only one card');
  assert.ok(samples.some((peeks) => peeks[2][1] > 0.9), 'one player should lift a card fully face-on');
  assert.ok(samples.some((peeks) => peeks[3][1] > 0 && peeks[3][0] === 0), 'one player should peek out of order');
});

test('Poker cycles three distinct hands, winners, folds, bets, and peek rhythms', () => {
  assert.equal(POKER_CINEMATIC_HANDS.length, 3);
  assert.equal(new Set(POKER_CINEMATIC_HANDS.map(({ board }) => board.join(' '))).size, 3);
  assert.equal(new Set(POKER_CINEMATIC_HANDS.map(({ seats }) => seats.flat().join(' '))).size, 3);
  assert.equal(new Set(POKER_CINEMATIC_HANDS.map(({ winnerSeat }) => winnerSeat)).size, 3);
  assert.equal(new Set(POKER_CINEMATIC_HANDS.map(({ foldSeats }) => foldSeats.join(','))).size, 3);
  assert.equal(new Set(POKER_CINEMATIC_HANDS.map(({ bets }) => bets.map(({ seat, amount }) => `${seat}:${amount}`).join(','))).size, 3);
  const peekSignatures = POKER_CINEMATIC_HANDS.map((_, handIndex) => Array.from({ length: 101 }, (__, index) => pokerLoopState(index / 100, handIndex).seatPeeks.flat().map((value) => value.toFixed(2)).join(',')).join('|'));
  assert.equal(new Set(peekSignatures).size, 3);
  assert.deepEqual([0, 1, 2, 3].map((iteration) => pokerLoopState(0.5, iteration).handIndex), [0, 1, 2, 0]);
});

function shiftedPhase(original: number): number { return (original * 18 + 3.48) / POKER_LOOP_SECONDS; }
function firstShiftedPhase(original: number): number { return (original * 18 + 0.48) / POKER_LOOP_SECONDS; }

test('Poker bets keep immutable chip values and only animate travel', () => {
  const arriving = pokerLoopState(shiftedPhase(0.44), 3).bets;
  const settled = pokerLoopState(shiftedPhase(0.7), 3).bets;
  assert.deepEqual(arriving.map(({ seat, amount }) => ({ seat, amount })), [
    { seat: 2, amount: 120 }, { seat: 4, amount: 120 }, { seat: 0, amount: 240 },
  ]);
  assert.deepEqual(settled.map(({ seat, amount }) => ({ seat, amount })), arriving.map(({ seat, amount }) => ({ seat, amount })));
  assert.ok(arriving.some(({ travel }) => travel < 1));
  assert.ok(settled.every(({ travel }) => travel === 1));
});

test('Poker cinematic conserves physical chips through every hand, pot, and award', () => {
  for (let handIndex = 0; handIndex < POKER_CINEMATIC_HANDS.length; handIndex++) for (const phase of [0, ...[0.4, 0.51, 0.7, 0.83, 0.85, 0.9].map(shiftedPhase), 1]) {
    const hand = pokerLoopState(phase, handIndex);
    const stacks = Array.from({ length: 5 }, () => playerColumns(1000));
    const bets = hand.bets.map((bet) => {
      const moved = takeChipColumns(stacks[bet.seat], bet.amount);
      stacks[bet.seat] = moved.remaining;
      return moved.pushed;
    });
    const pot = mergeChipColumns(...bets);
    if (hand.award >= 1) stacks[hand.winnerSeat] = mergeChipColumns(stacks[hand.winnerSeat], pot);
    const inFlightOrPot = hand.award >= 1 ? 0 : chipAmount(pot);
    assert.equal(stacks.reduce((sum, stack) => sum + chipAmount(stack), 0) + inFlightOrPot, 5000, `hand ${handIndex}, phase ${phase}`);
  }
});
