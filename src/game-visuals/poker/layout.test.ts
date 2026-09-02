import assert from 'node:assert/strict';
import { test } from 'node:test';
import { playerColumns } from './chips.ts';
import { POKER_BOARD_Z, POKER_DECK_POSITION, pokerBetCenter, pokerBoardCardPose, POKER_HOLE_GAP, pokerHoleCardPose, pokerStackCenter } from './layout.ts';

test('five-seat production layout keeps every carried stack clear of both hole cards', () => {
  for (let seat = 0; seat < 5; seat++) {
    const stack = pokerStackCenter(seat, 5, playerColumns(1000));
    for (let round = 0; round < 2; round++) {
      const card = pokerHoleCardPose(seat, round, 5);
      assert.ok(Math.hypot(stack.x - card.x, stack.z - card.z) > POKER_HOLE_GAP);
    }
  }
});

test('production deck, fixed board row, and bets occupy disjoint felt regions', () => {
  const board = Array.from({ length: 5 }, (_, index) => pokerBoardCardPose(index));
  assert.equal(board[0].z, POKER_BOARD_Z);
  assert.ok(board.every((card) => Math.hypot(card.x - POKER_DECK_POSITION.x, card.z - POKER_DECK_POSITION.z) > 1));
  for (const seat of [0, 2, 4]) {
    const columns = playerColumns(220);
    const bet = pokerBetCenter(seat, 5, columns, 20 + seat, 5);
    for (const card of board) assert.ok(Math.hypot(bet.x - card.x, bet.z - card.z) > 0.72, `seat ${seat} bet must clear board card`);
  }
});
