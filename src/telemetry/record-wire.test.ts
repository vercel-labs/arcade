import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RECORD_SCHEMA_VERSION,
  type PokerHandRecord,
} from '../harness/records.ts';
import { isPrivacySafeRecord, toCanonicalRecordRow } from './record-wire.ts';

function hand(): PokerHandRecord {
  return {
    recordType: 'poker_hand',
    recordSchemaVersion: RECORD_SCHEMA_VERSION,
    recordId: 'record-1',
    revision: 1,
    matchId: 'match-1',
    handId: 'hand-1',
    handNumber: 1,
    game: 'poker',
    rulesVersion: 'holdem-v1',
    status: 'completed',
    endReason: 'natural',
    startedAt: '2026-07-17T10:00:00.000Z',
    endedAt: '2026-07-17T10:01:00.000Z',
    lastActionSeq: 1,
    participants: [
      { participantId: 'p0', kind: 'model', role: 'seat-0' },
      { participantId: 'p1', kind: 'model', role: 'seat-1' },
    ],
    controllerAssignments: [
      { assignmentId: 'a0', participantId: 'p0', controllerKind: 'model', requestedModel: 'openai/gpt-x', startActionSeq: 0 },
      { assignmentId: 'a1', participantId: 'p1', controllerKind: 'model', requestedModel: 'anthropic/claude-x', startActionSeq: 0 },
    ],
    buttonParticipantId: 'p0',
    smallBlindParticipantId: 'p0',
    bigBlindParticipantId: 'p1',
    smallBlind: 10,
    bigBlind: 20,
    finalStreet: 'preflop',
    cards: [
      { card: 'As', dealtToParticipantId: 'p0', dealtAtActionSeq: 0 },
      { card: 'Kh', dealtToParticipantId: 'p1', dealtAtActionSeq: 0, publicAtActionSeq: 1 },
    ],
    actions: [
      {
        actionId: 'act-1',
        seq: 1,
        participantId: 'p0',
        assignmentId: 'a0',
        phase: 'preflop',
        applied: { kind: 'fold', allIn: false, adjusted: false, amountAdded: 0, potBefore: 30, stackBefore: 990, toCallBefore: 10 },
      },
    ],
    awards: [{ participantId: 'p1', amount: 30, potIndex: 0 }],
    results: [
      { participantId: 'p0', dealtIn: true, startingStack: 1000, endingStack: 990, committed: 10, awarded: 0, netChips: -10, folded: true, reachedShowdown: false, wonAnyPot: false },
      { participantId: 'p1', dealtIn: true, startingStack: 1000, endingStack: 1010, committed: 20, awarded: 30, netChips: 10, folded: false, reachedShowdown: false, wonAnyPot: true },
    ],
  };
}

test('canonical poker rows retain hidden cards but omit stable install identity', () => {
  const row = toCanonicalRecordRow(hand(), {
    session: 'run-1',
    env: 'prod',
    appVersion: '0.1.1',
    emittedAt: '2026-07-17T10:02:00.000Z',
  });
  assert.ok(row);
  assert.equal(row.recordId, 'record-1');
  assert.equal(row.handId, 'hand-1');
  assert.equal(row.actionCount, 1);
  assert.match(row.payloadJson, /"card":"As"/);
  assert.equal('installId' in row, false);
});

test('privacy guard rejects accidentally attached prompt/chat/reasoning fields', () => {
  for (const unsafe of [
    { ...hand(), prompt: 'secret' },
    { ...hand(), details: { chat: 'hello' } },
    { ...hand(), actions: [{ ...hand().actions[0], reasoning: 'private chain' }] },
    { ...hand(), provider_error: 'raw failure' },
  ]) {
    assert.equal(isPrivacySafeRecord(unsafe), false);
    assert.equal(
      toCanonicalRecordRow(unsafe as PokerHandRecord, { session: 's', env: 'prod', appVersion: 'v' }),
      null,
    );
  }
});

test('playerKey tags the envelope only when a human participated', () => {
  const aiOnly = toCanonicalRecordRow(hand(), { session: 's', env: 'prod', appVersion: 'v', playerKey: 'pk-abc' });
  assert.ok(aiOnly);
  assert.equal(aiOnly.playerKey, '');

  const withHuman = {
    ...hand(),
    participants: [
      { participantId: 'p0', kind: 'human', role: 'seat-0' },
      { participantId: 'p1', kind: 'model', role: 'seat-1' },
    ],
  } as PokerHandRecord;
  const row = toCanonicalRecordRow(withHuman, { session: 's', env: 'prod', appVersion: 'v', playerKey: 'pk-abc' });
  assert.ok(row);
  assert.equal(row.playerKey, 'pk-abc');
});

test('an oversized canonical record is rejected rather than enqueued', () => {
  const big = { ...hand(), filler: 'x'.repeat(1_000_000) } as unknown as PokerHandRecord;
  assert.equal(
    toCanonicalRecordRow(big, { session: 's', env: 'prod', appVersion: 'v' }),
    null,
  );
});

test('privacy guard accepts omitted optional fields represented as undefined', () => {
  assert.equal(isPrivacySafeRecord({ requestedModel: 'openai/test', runtime: undefined }), true);
});

test('privacy guard rejects circular records without throwing', () => {
  const unsafe: Record<string, unknown> = { ...hand() };
  unsafe.loop = unsafe;
  assert.equal(isPrivacySafeRecord(unsafe), false);
});
