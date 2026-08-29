// Pins the wire shape of everything the client emits against a vendored mirror of the
// Tinybird datasource columns (ai-gateway/tinybird-src/datasources/arcade_*_v1.datasource).
// The datasources live in another repo, so CI cannot diff them directly; instead any
// change to an emitted row fails here and forces a conscious look at the schemas.
// If you edit a mirror below, update the corresponding .datasource file (or vice versa).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

// The telemetry module resolves env + config at import, so stage both before the dynamic
// import: an endpoint override (opens the dev gate, keeps requests off the real proxy)
// and an isolated config dir with the first-run notice already acknowledged.
process.env.ARCADE_TELEMETRY_ENDPOINT = 'https://proxy.test';
delete process.env.ARCADE_TELEMETRY;
const configRoot = mkdtempSync(join(tmpdir(), 'arcade-drift-'));
process.env.XDG_CONFIG_HOME = configRoot;
mkdirSync(join(configRoot, 'arcade'), { recursive: true });
writeFileSync(
  join(configRoot, 'arcade', 'telemetry.json'),
  JSON.stringify({ installId: 'drift-install', noticeVersion: 999 }),
);

const telemetry = await import('./index.ts');
const { RECORD_SCHEMA_VERSION, toCanonicalRecordRow } = telemetry;
type ChessMatchRecord = import('../harness/records.ts').ChessMatchRecord;
type PokerHandRecord = import('../harness/records.ts').PokerHandRecord;

type ColumnKind = 'string' | 'number' | 'boolean' | 'string[]';

// ---- vendored column mirrors (name → wire type) ----

// arcade_events_v1.datasource
const EVENTS_COLUMNS: Record<string, ColumnKind> = {
  timestamp: 'string',
  event: 'string',
  environment: 'string',
  appVersion: 'string',
  sessionId: 'string',
  installId: 'string',
  game: 'string',
  mode: 'string',
  models: 'string[]',
  winner: 'string',
  winners: 'string[]',
  pot: 'number',
  humans: 'number',
  stack: 'number',
  model: 'string',
  reason: 'string',
  colorMode: 'string',
  authed: 'boolean',
  cols: 'number',
  rows: 'number',
  node: 'string',
};
// Columns without a datasource DEFAULT: every event row must carry them.
const EVENTS_REQUIRED = ['timestamp', 'event', 'environment', 'appVersion', 'sessionId', 'installId'];

// arcade_match_records_v1.datasource
const MATCH_RECORD_COLUMNS: Record<string, ColumnKind> = {
  emittedAt: 'string',
  sessionId: 'string',
  playerKey: 'string',
  environment: 'string',
  appVersion: 'string',
  recordType: 'string',
  recordSchemaVersion: 'number',
  recordId: 'string',
  recordRevision: 'number',
  matchId: 'string',
  game: 'string',
  rulesVersion: 'string',
  status: 'string',
  endReason: 'string',
  startedAt: 'string',
  endedAt: 'string',
  participantCount: 'number',
  actionCount: 'number',
  payloadJson: 'string',
};

// arcade_poker_hand_records_v1.datasource = the match columns + hand identity.
const POKER_HAND_RECORD_COLUMNS: Record<string, ColumnKind> = {
  ...MATCH_RECORD_COLUMNS,
  handId: 'string',
  handNumber: 'number',
};

// Columns typed DateTime64 downstream: the wire value must be a parseable timestamp.
const DATETIME_COLUMNS = new Set(['timestamp', 'emittedAt', 'startedAt', 'endedAt']);

// Model the NDJSON serialization: JSON.stringify drops undefined-valued fields, so this
// is the exact shape Tinybird's jsonpaths see.
function wire(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function assertMatchesColumns(row: Record<string, unknown>, columns: Record<string, ColumnKind>, extras: string[] = []): void {
  for (const [key, value] of Object.entries(row)) {
    if (extras.includes(key)) continue;
    const kind = columns[key];
    assert.ok(kind, `emitted field "${key}" has no datasource column — update the schema (and this mirror) first`);
    if (kind === 'string[]') {
      assert.ok(Array.isArray(value) && value.every((v) => typeof v === 'string'), `field "${key}" should be a string array`);
    } else {
      assert.equal(typeof value, kind, `field "${key}" wire type`);
    }
    if (DATETIME_COLUMNS.has(key)) {
      assert.ok(Number.isFinite(Date.parse(value as string)), `field "${key}" must parse as a timestamp`);
    }
  }
}

// ---- fixtures ----

function chessMatch(): ChessMatchRecord {
  return {
    recordType: 'match',
    recordSchemaVersion: RECORD_SCHEMA_VERSION,
    recordId: 'record-m1',
    revision: 2,
    matchId: 'match-m1',
    game: 'chess',
    rulesVersion: 'chess-v1',
    status: 'completed',
    endReason: 'natural',
    startedAt: '2026-07-17T10:00:00.000Z',
    endedAt: '2026-07-17T10:05:00.000Z',
    lastActionSeq: 1,
    participants: [
      { participantId: 'white', kind: 'model', role: 'white' },
      { participantId: 'black', kind: 'human', role: 'black' },
    ],
    controllerAssignments: [
      { assignmentId: 'a0', participantId: 'white', controllerKind: 'model', requestedModel: 'openai/gpt-x', startActionSeq: 0 },
      { assignmentId: 'a1', participantId: 'black', controllerKind: 'human', startActionSeq: 0 },
    ],
    actions: [
      {
        actionId: 'act-1',
        seq: 1,
        participantId: 'white',
        assignmentId: 'a0',
        phase: 'move',
        applied: { uci: 'e2e4', san: 'e4', legal: true, from: 'e2', to: 'e4', movingPiece: 'P', flags: [] },
      },
    ],
    results: [
      { participantId: 'white', result: 'win' },
      { participantId: 'black', result: 'loss' },
    ],
    details: { mode: 'human_vs_ai', initialFen: 'start-fen', endingFen: 'end-fen', allowIllegalMoves: false },
  };
}

function pokerHand(): PokerHandRecord {
  return {
    recordType: 'poker_hand',
    recordSchemaVersion: RECORD_SCHEMA_VERSION,
    recordId: 'record-h1',
    revision: 1,
    matchId: 'match-p1',
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
    cards: [{ card: 'As', dealtToParticipantId: 'p0', dealtAtActionSeq: 0 }],
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

const envelope = { session: 'run-1', env: 'prod' as const, appVersion: '0.1.2', playerKey: 'pk-hash', emittedAt: '2026-07-17T10:02:00.000Z' };

// ---- canonical record rows ----

test('poker hand rows cover the poker datasource columns exactly', () => {
  const row = wire(toCanonicalRecordRow(pokerHand(), envelope));
  assert.deepEqual(Object.keys(row).sort(), Object.keys(POKER_HAND_RECORD_COLUMNS).sort());
  assertMatchesColumns(row, POKER_HAND_RECORD_COLUMNS);
});

test('match rows cover the match datasource columns (hand fields are ignored extras)', () => {
  const row = wire(toCanonicalRecordRow(chessMatch(), envelope));
  // handId/handNumber have no column in arcade_match_records_v1; Tinybird jsonpath
  // ingestion ignores unmapped fields, so they are harmless — but keep them pinned.
  assert.deepEqual(Object.keys(row).sort(), [...Object.keys(MATCH_RECORD_COLUMNS), 'handId', 'handNumber'].sort());
  assertMatchesColumns(row, MATCH_RECORD_COLUMNS, ['handId', 'handNumber']);
});

test('an unfinished record omits endedAt so the column DEFAULT applies (never a sentinel)', () => {
  const inProgress: PokerHandRecord = { ...pokerHand(), status: 'in_progress' };
  delete inProgress.endedAt;
  delete inProgress.endReason;
  const row = wire(toCanonicalRecordRow(inProgress, envelope));
  assert.equal('endedAt' in row, false);
  assert.equal(row.endReason, ''); // defaulted client-side, still a column
  assertMatchesColumns(row, POKER_HAND_RECORD_COLUMNS);
});

// ---- event rows (the real wire path: track* helpers through a stubbed fetch) ----

test('every event helper emits only arcade_events_v1 columns', async () => {
  const captured: Record<string, unknown>[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    captured.push(JSON.parse(String(init?.body).trim()) as Record<string, unknown>);
    return new Response('{"ok":true}', { status: 200 });
  }) as typeof fetch;
  try {
    telemetry.initTelemetry();
    telemetry.trackSessionStart({ colorMode: 'truecolor', authed: true, cols: 120, rows: 40 });
    telemetry.trackMatchStarted({ game: 'poker', mode: 'ai_table', models: ['openai/gpt-x'], humans: 1, stack: 1000 });
    telemetry.trackMatchEnded({ game: 'chess', mode: 'human_vs_ai', models: ['openai/gpt-x'], winner: 'human' });
    telemetry.trackHandEnded({ game: 'poker', winners: ['p1'], pot: 30 });
    telemetry.trackModelFallback({ game: 'chess', model: 'openai/gpt-x', reason: 'exhausted' });
    await telemetry.flushTelemetry(1000);
  } finally {
    globalThis.fetch = realFetch;
  }

  assert.deepEqual(
    captured.map((row) => row.event),
    ['session_start', 'match_started', 'match_ended', 'hand_ended', 'model_fallback'],
  );
  for (const row of captured) {
    assertMatchesColumns(row, EVENTS_COLUMNS);
    for (const required of EVENTS_REQUIRED) {
      assert.ok(required in row, `event "${String(row.event)}" is missing required column "${required}"`);
    }
  }
});
