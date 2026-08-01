import assert from 'node:assert/strict';
import test from 'node:test';
import type { ActionChoice, Player } from '../../ai/player.ts';
import { ChessState } from '../../rules/chess/chess.ts';
import type { Move } from '../../rules/chess/types.ts';
import { HoldemState, type PokerAction } from '../../rules/poker/holdem.ts';
import { toCanonicalRecordRow } from '../../telemetry/records.ts';
import { CHESS_CHECKPOINT_INTERVAL_PLIES, ChessGameRecorder, PokerSessionRecorder } from './game-recorders.ts';

const player = <A>(name: string): Player<A> => ({
  name,
  async chooseAction(): Promise<ActionChoice<A>> {
    throw new Error('test player is identity-only');
  },
});

test('chess recorder persists replay state and temporal model assignments', () => {
  const state = new ChessState();
  const recorder = new ChessGameRecorder(
    'ai_vs_ai',
    [{ kind: 'model', model: 'openai/a' }, { kind: 'model', model: 'anthropic/b' }],
    state.fen(),
    false,
  );

  const play = (seat: number, model: string, san: string): void => {
    const move = state.actionFromString(san);
    assert.ok(move);
    const choice: ActionChoice<Move> = {
      action: move,
      diagnostics: { resolution: 'structured', durationMs: 12, attempts: [], illegalMode: false },
    };
    recorder.actionChosen(seat, player(model), choice, state, false, false);
    const canonicalSan = state.actionToString(move);
    state.applyAction(move);
    recorder.actionApplied(state, canonicalSan, false);
  };

  play(0, 'openai/a', 'e4');
  play(1, 'anthropic/b', 'e5');
  play(0, 'google/c', 'Nf3'); // same participant, different controller/model

  const record = recorder.abandoned('user_stopped', state.fen());
  assert.ok(record);
  assert.equal(record.actions.length, 3);
  assert.equal(record.actions[0].applied.san, 'e4');
  assert.equal(record.actions[0].applied.fenBefore, undefined);
  assert.equal(record.actions[2].applied.fenAfter, undefined);
  assert.equal(record.controllerAssignments.filter((a) => a.participantId === record.participants[0].participantId).length, 2);
  assert.deepEqual(
    record.actions.filter((a) => a.participantId === record.participants[0].participantId).map((a) => record.controllerAssignments.find((x) => x.assignmentId === a.assignmentId)?.requestedModel),
    ['openai/a', 'google/c'],
  );
  assert.ok(toCanonicalRecordRow(record, { session: 'test', env: 'dev', appVersion: 'test' }));
});

test('a human controller carries the pseudonymous playerKey; a model carries its slug', () => {
  const state = new ChessState();
  const recorder = new ChessGameRecorder(
    'human_vs_ai',
    [{ kind: 'human' }, { kind: 'model', model: 'openai/a' }],
    state.fen(),
    false,
    'pk-hash-123',
  );
  const record = recorder.abandoned('user_stopped', state.fen());
  assert.ok(record);
  const human = record.participants.find((p) => p.kind === 'human');
  const model = record.participants.find((p) => p.kind === 'model');
  assert.ok(human && model);
  const humanAssignment = record.controllerAssignments.find((a) => a.participantId === human.participantId);
  const modelAssignment = record.controllerAssignments.find((a) => a.participantId === model.participantId);
  assert.equal(humanAssignment?.playerKey, 'pk-hash-123'); // the human's "slug"
  assert.equal(humanAssignment?.requestedModel, undefined);
  assert.equal(modelAssignment?.playerKey, undefined);
  assert.equal(modelAssignment?.requestedModel, 'openai/a');
});

test('chess recorder checkpoints coarsely and keeps a FEN chain only in illegal mode', () => {
  const state = new ChessState();
  const recorder = new ChessGameRecorder(
    'ai_vs_ai',
    [{ kind: 'model', model: 'openai/a' }, { kind: 'model', model: 'anthropic/b' }],
    state.fen(),
    false,
  );
  const cycle = ['Nf3', 'Nf6', 'Ng1', 'Ng8'];
  for (let ply = 0; ply < CHESS_CHECKPOINT_INTERVAL_PLIES; ply++) {
    const san = cycle[ply % cycle.length];
    const move = state.actionFromString(san);
    assert.ok(move);
    recorder.actionChosen(
      ply % 2,
      player(ply % 2 ? 'anthropic/b' : 'openai/a'),
      { action: move },
      state,
      false,
      ply >= 2,
    );
    const canonicalSan = state.actionToString(move);
    state.applyAction(move);
    recorder.actionApplied(state, canonicalSan, false);
    assert.equal(recorder.checkpoint(state.fen()) !== null, ply + 1 === CHESS_CHECKPOINT_INTERVAL_PLIES);
  }
  const record = recorder.abandoned('user_stopped', state.fen());
  assert.ok(record);
  assert.equal(record.details.allowIllegalMoves, true);
  assert.equal(record.actions[0].applied.fenBefore, undefined);
  assert.ok(record.actions[2].applied.fenBefore);
  assert.equal(record.actions.at(-1)?.applied.fenAfter, record.details.endingFen);
});

test('poker recorder links full hidden hand data to a multi-participant match', () => {
  const state = new HoldemState({
    stacks: [1000, 1000],
    button: 0,
    smallBlind: 10,
    bigBlind: 20,
    rng: () => 0.5,
  });
  const recorder = new PokerSessionRecorder(
    'ai_table',
    [{ kind: 'model', model: 'openai/a', runtime: 'text' }, { kind: 'model', model: 'anthropic/b', runtime: 'text' }],
    [1000, 1000],
    10,
    20,
  );
  recorder.beginHand();
  const action: PokerAction = { type: 'fold' };
  // Realtime players may expose a short display name; the seat spec remains the
  // canonical Gateway slug and must not create a false controller switch.
  recorder.actionChosen(0, player('a-display-name'), { action }, false, 'text', 'openai/a');
  state.applyAction(action);
  recorder.actionApplied();

  const hand = recorder.finishHand(state.canonicalRecord(), true);
  assert.equal(hand.actions.length, 1);
  assert.equal(hand.results.length, 2);
  assert.equal(hand.cards.filter((c) => c.dealtToParticipantId).length, 4);
  assert.equal(hand.cards.filter((c) => c.publicAtActionSeq !== undefined).length, 0);
  assert.equal(hand.actions[0].applied.kind, 'fold');
  assert.equal(hand.actions[0].applied.allIn, false);
  assert.equal(hand.actions[0].applied.adjusted, false);
  assert.equal(hand.actions[0].participantId, hand.participants[0].participantId);
  assert.equal(hand.controllerAssignments.length, 2);
  assert.equal(hand.controllerAssignments[0].requestedModel, 'openai/a');

  const match = recorder.finishMatch([990, 1010], false, 'user_stopped');
  assert.ok(match);
  assert.equal(match.details.handCount, 1);
  assert.equal(match.results.length, 2);
  assert.ok(match.results.every((r) => r.result === 'unranked'));
});

test('poker recorder preserves effective all-ins and the hand abandonment reason', () => {
  const state = new HoldemState({
    stacks: [20, 1000],
    button: 0,
    smallBlind: 10,
    bigBlind: 20,
    rng: () => 0.5,
  });
  const recorder = new PokerSessionRecorder(
    'ai_table',
    [{ kind: 'model', model: 'openai/a' }, { kind: 'model', model: 'anthropic/b' }],
    [20, 1000],
    10,
    20,
  );
  recorder.beginHand();
  const action: PokerAction = { type: 'call' };
  recorder.actionChosen(0, player('openai/a'), { action }, false);
  state.applyAction(action);
  recorder.actionApplied();

  const hand = recorder.finishHand(state.canonicalRecord(), false, 'navigation');
  assert.equal(hand.status, 'abandoned');
  assert.equal(hand.endReason, 'navigation');
  assert.equal(hand.actions[0].applied.kind, 'call');
  assert.equal(hand.actions[0].applied.allIn, true);
});
