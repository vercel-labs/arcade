import assert from 'node:assert/strict';
import test from 'node:test';
import type { ActionChoice, Player } from '../player.ts';
import { ChessState } from '../../rules/chess/chess.ts';
import type { Move } from '../../rules/chess/types.ts';
import { HoldemState, type PokerAction } from '../../rules/poker/holdem.ts';
import { IslandersState } from '../../rules/islanders/islanders.ts';
import type { IslandersAction } from '../../rules/islanders/types.ts';
import { MAX_RECORD_ROW_BYTES, toCanonicalRecordRow } from '../../telemetry/record-wire.ts';
import {
  CHESS_CHECKPOINT_INTERVAL_PLIES,
  IslandersGameRecorder,
  PokerSessionRecorder,
  ChessGameRecorder,
  islandersTranscriptFromRecord,
  isIslandersCheckpointAction,
} from './game-recorders.ts';

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

test('Islanders recorder carries every mechanical action and replays the exact rules state', () => {
  const state = new IslandersState({ numPlayers: 2, domesticTrade: true, rng: seeded(42) });
  const recorder = new IslandersGameRecorder(
    'ai_table',
    [{ kind: 'model', model: 'openai/a' }, { kind: 'model', model: 'anthropic/b' }],
    ['red', 'blue'],
  );
  for (let seq = 0; seq < 400 && !state.isTerminal(); seq++) {
    const legal = state.legalActions();
    const action = chooseProgressingAction(legal, seq);
    const seat = state.currentPlayer();
    recorder.actionChosen(seat, player(seat === 0 ? 'openai/a' : 'anthropic/b'), {
      action,
      diagnostics: { resolution: 'structured', durationMs: seq, attempts: [], illegalMode: false },
    }, state, false, seat === 0 ? 'openai/a' : 'anthropic/b');
    state.applyAction(action);
    recorder.actionApplied(state);
  }
  const record = recorder.abandoned('user_stopped', state);
  assert.ok(record);
  assert.equal(record.actions.length, state.actionRecords().length);
  assert.ok(record.actions.some((entry) => entry.applied.action.type === 'roll' && entry.applied.outcome?.dice));
  assert.doesNotMatch(JSON.stringify(record), /chat|rationale|reasoning/i);

  const replayed = IslandersState.replay(islandersTranscriptFromRecord(record), () => 0.99);
  assert.equal(replayed.toString(), state.toString());
  assert.deepEqual(replayed.actionRecords(), state.actionRecords());
});

test('Islanders checkpoints widen exponentially instead of cloning every 25 actions forever', () => {
  const points = Array.from({ length: 10_000 }, (_, index) => index + 1).filter(isIslandersCheckpointAction);
  assert.deepEqual(points, [25, 50, 100, 200, 400, 800, 1600, 3200, 6400]);
  assert.ok(points.length < 10, 'checkpoint work stays logarithmic at the live action bound');
});

test('Islanders records counteroffer withdrawal as a replayable mechanical action', () => {
  const state = new IslandersState({ numPlayers: 2, domesticTrade: true, rng: seeded(7) });
  while (!state.initialPlacementComplete()) state.applyAction(state.legalActions()[0]);
  state.applyAction({ type: 'roll' }, { dice: [1, 1] });
  const hands = (state as unknown as { hands: number[][] }).hands;
  hands[0] = [1, 0, 0, 0, 0];
  hands[1] = [0, 1, 0, 0, 0];
  state.applyAction({ type: 'offerTrade', give: [1, 0, 0, 0, 0], receive: [0, 1, 0, 0, 0] });
  state.applyAction({ type: 'counterTrade', give: [0, 1, 0, 0, 0], receive: [1, 0, 0, 0, 0] });
  assert.equal(state.withdrawCounterOffer(1), true);
  assert.equal(state.actionRecords().at(-1)?.action.type, 'withdrawCounterTrade');
});

test('Islanders rebases an interrupted pending choice around an out-of-turn withdrawal', () => {
  const state = new IslandersState({ numPlayers: 2, domesticTrade: true, rng: seeded(11) });
  while (!state.initialPlacementComplete()) state.applyAction(state.legalActions()[0]);
  state.applyAction({ type: 'roll' }, { dice: [1, 1] });
  const hands = (state as unknown as { hands: number[][] }).hands;
  hands[0] = [1, 0, 0, 0, 0]; hands[1] = [0, 1, 0, 0, 0];
  state.applyAction({ type: 'offerTrade', give: [1, 0, 0, 0, 0], receive: [0, 1, 0, 0, 0] });
  state.applyAction({ type: 'counterTrade', give: [0, 1, 0, 0, 0], receive: [1, 0, 0, 0, 0] });
  const recorder = new IslandersGameRecorder('mixed', [{ kind: 'model', model: 'm' }, { kind: 'human' }], ['red', 'blue']);
  recorder.actionChosen(0, player('m'), { action: { type: 'confirmTrade', with: 1 } }, state, false, 'm');
  state.applyAction({ type: 'withdrawCounterTrade', player: 1 });
  assert.doesNotThrow(() => recorder.externalActionApplied(state));
  const record = recorder.abandoned('user_stopped', state);
  assert.ok(record);
  assert.equal(record.actions.at(-1)?.applied.action.type, 'withdrawCounterTrade');
});

test('Islanders live action bound stays within the canonical one-row transport ceiling', () => {
  const state = new IslandersState({ numPlayers: 4, domesticTrade: true, domesticTradeOfferLimit: 3, rng: seeded(99) });
  const models = Array.from({ length: 4 }, (_, seat) => player<IslandersAction>(`model/${seat}`));
  const recorder = new IslandersGameRecorder(
    'ai_table',
    models.map((_, seat) => ({ kind: 'model', model: `model/${seat}` })),
    ['red', 'blue', 'purple', 'orange'],
  );
  const attempts = Array.from({ length: 4 }, (_, sequence) => ({
    phase: 'structured' as const,
    sequence,
    result: sequence === 3 ? 'accepted' as const : 'rejected' as const,
    ...(sequence === 3 ? {} : { rejectionReason: 'illegal' as const }),
    latencyMs: 999,
    inputTokens: 9_999,
    outputTokens: 9_999,
  }));
  for (let seq = 0; seq < 8_000 && !state.isTerminal(); seq++) {
    const action = state.legalActions().find((candidate) => candidate.type === 'roll')
      ?? state.legalActions().find((candidate) => candidate.type === 'endTurn')
      ?? state.legalActions()[0];
    const seat = state.currentPlayer();
    recorder.actionChosen(seat, models[seat], {
      action,
      diagnostics: { resolution: 'structured', durationMs: 9_999, attempts, illegalMode: false },
    }, state, false, `model/${seat}`);
    state.applyAction(action);
    recorder.actionApplied(state);
  }
  const record = recorder.abandoned('action_limit', state);
  assert.ok(record);
  const row = toCanonicalRecordRow(record, { session: 's', env: 'prod', appVersion: 'test' });
  assert.ok(row, 'the complete worst-case record fits the real telemetry envelope');
  assert.ok(Buffer.byteLength(JSON.stringify(row)) <= MAX_RECORD_ROW_BYTES);
});

function seeded(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) | 0;
    let x = Math.imul(value ^ (value >>> 15), 1 | value);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function chooseProgressingAction(actions: IslandersAction[], seq: number): IslandersAction {
  const nonRoutine = actions.filter((action) => action.type !== 'endTurn');
  return (nonRoutine.length ? nonRoutine : actions)[seq % (nonRoutine.length || actions.length)];
}

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
