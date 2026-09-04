import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Player } from '../../../src/harness/player.ts';
import { runHeadlessChessMatch } from '../../../src/harness/games/chess/chess-session.ts';
import { preparePokerCardTextures } from '../../../src/game-visuals/poker/cards.ts';
import { planChessMove } from '../../../src/game-visuals/chess/move-animation.ts';
import { fetchChessPieceMeshes } from '../../../src/game-visuals/chess/pieces.ts';
import { ChessState } from '../../../src/rules/chess/chess.ts';
import type { Move } from '../../../src/rules/chess/types.ts';
import { CATEGORY_NAMES, evaluate } from '../../../src/rules/poker/hand-eval.ts';
import { parseCard } from '../../../src/rules/poker/cards.ts';
import { HoldemState } from '../../../src/rules/poker/holdem.ts';

test('the documented Chess visual calls match their public signatures', () => {
  const load = () => fetchChessPieceMeshes('/assets/chess_blender', async () => '');
  assert.equal(typeof load, 'function');
  const state = new ChessState();
  const move = state.actionFromString('Nf3');
  assert.ok(move);
  const plan = planChessMove(move, { square: 1, whiteJailCount: 0, blackJailCount: 0 });
  assert.ok(plan.segments.every((segment) => Number.isInteger(segment.hideSq) && Number.isInteger(segment.type)));
});

test('the documented headless Chess runner shape completes a bounded match', async () => {
  const firstLegal = (name: string): Player<Move> => ({
    name,
    chooseAction: async (state) => ({ action: state.legalActions()[0] }),
  });
  const result = await runHeadlessChessMatch(new ChessState(), [firstLegal('white'), firstLegal('black')], { maxPlies: 1 });
  assert.equal(result.status, 'bounded');
  assert.equal(result.plies, 1);
});

test('the documented Poker fixtures construct and evaluate as described', async () => {
  const hand = new HoldemState({ stacks: [1000, 1000, 1000], button: 0, smallBlind: 10, bigBlind: 20, rng: () => 0.5 });
  assert.ok(hand.legalActions().length > 0);
  const cards = ['Ah', 'Ac', 'Kh', 'Qh', 'Jh', '9h', '2h'].map((card) => parseCard(card)!);
  const value = evaluate(cards);
  assert.equal(CATEGORY_NAMES[value.category], 'Flush');
  assert.deepEqual(value.ranks, [14, 13, 12, 11, 9]);
  await preparePokerCardTextures();
});
