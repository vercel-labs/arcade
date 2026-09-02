import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChessState } from '../../rules/chess/chess.ts';
import { KING, KNIGHT, ROOK } from '../../rules/chess/types.ts';
import { chessMovePosition, planChessMove } from './move-animation.ts';

test('production plan makes knights hop and castling move king and rook together', () => {
  const opening = new ChessState();
  const knight = opening.actionFromString('Nf3')!;
  const knightPlan = planChessMove(knight, { square: 1.05, whiteJailCount: 0, blackJailCount: 0 });
  assert.equal(knightPlan.segments[0].type, KNIGHT);
  assert.ok(chessMovePosition(knightPlan.segments[0], 0.5).y > 0.49);

  const castleGame = new ChessState('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  const castle = castleGame.actionFromString('O-O')!;
  assert.deepEqual(planChessMove(castle, { square: 1.05, whiteJailCount: 0, blackJailCount: 0 }).segments.map(({ type }) => type), [KING, ROOK]);
});

test('production capture plan moves both pieces and records jail identity', () => {
  const game = new ChessState('8/8/8/3p4/4P3/8/8/4K2k w - - 0 1');
  const capture = game.actionFromString('exd5')!;
  const plan = planChessMove(capture, { square: 1.05, whiteJailCount: 2, blackJailCount: 0 });
  assert.equal(plan.segments.length, 2);
  assert.ok(plan.captured);
  assert.notEqual(plan.segments[0].hideSq, plan.segments[1].hideSq);
});
