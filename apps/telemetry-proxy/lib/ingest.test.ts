import assert from 'node:assert/strict';
import test from 'node:test';
import { ingest, type IngestRequest } from './ingest.ts';
import { createRateLimiter } from './rate-limit.ts';
import type { RecordKind } from './validation.ts';
import type { DeliveryResult, Sink } from './sink.ts';

function capturingSink(result: DeliveryResult = 'ok') {
  const calls: { kind: RecordKind; rows: unknown[] }[] = [];
  const sink: Sink = {
    async deliver(kind, rows) {
      calls.push({ kind, rows });
      return result;
    },
  };
  return { sink, calls };
}

function matchRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    emittedAt: '2026-07-20T10:02:00.000Z',
    sessionId: 'run-1',
    environment: 'prod',
    appVersion: '0.1.2',
    recordType: 'match',
    recordSchemaVersion: 1,
    recordId: 'record-1',
    recordRevision: 1,
    matchId: 'match-1',
    handId: '',
    handNumber: 0,
    game: 'chess',
    rulesVersion: 'chess-v1',
    status: 'completed',
    endReason: 'natural',
    startedAt: '2026-07-20T10:00:00.000Z',
    endedAt: '2026-07-20T10:01:00.000Z',
    participantCount: 2,
    actionCount: 20,
    payloadJson: JSON.stringify({ recordType: 'match', moves: ['e4', 'e5'] }),
    ...overrides,
  };
}

const req = (kind: RecordKind, body: unknown): IngestRequest => ({
  kind,
  ip: '203.0.113.1',
  bodyText: `${typeof body === 'string' ? body : JSON.stringify(body)}\n`,
});

test('a valid match row is accepted and forwarded with the route kind', async () => {
  const { sink, calls } = capturingSink();
  const res = await ingest(req('match', matchRow()), { sink });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true, count: 1 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].kind, 'match');
});

test('a valid poker_hand row and a valid event row are accepted', async () => {
  const { sink } = capturingSink();
  const hand = await ingest(req('poker_hand', matchRow({ recordType: 'poker_hand', game: 'poker', handId: 'h1', handNumber: 1 })), { sink });
  assert.equal(hand.status, 200);
  const event = await ingest(req('event', { event: 'session_start', node: '22' }), { sink });
  assert.equal(event.status, 200);
});

test('the route kind is authoritative: a mismatched body type is rejected', async () => {
  const { sink, calls } = capturingSink();
  const res = await ingest(req('match', matchRow({ recordType: 'poker_hand' })), { sink });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { ok: false, error: 'record_type_mismatch' });
  assert.equal(calls.length, 0); // nothing forwarded
});

test('a privacy-forbidden field anywhere in the payload is rejected and not forwarded', async () => {
  const { sink, calls } = capturingSink();
  const res = await ingest(req('match', matchRow({ payloadJson: JSON.stringify({ recordType: 'match', reasoning: 'secret chain' }) })), { sink });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { ok: false, error: 'forbidden_field' });
  assert.equal(calls.length, 0);
});

test('malformed JSON and missing required fields are rejected', async () => {
  const { sink } = capturingSink();
  assert.equal((await ingest(req('match', '{not json'), { sink })).status, 400);
  const missing = matchRow();
  delete missing.recordId;
  const res = await ingest(req('match', missing), { sink });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { ok: false, error: 'bad_recordId' });
});

test('an empty body is rejected', async () => {
  const { sink } = capturingSink();
  const res = await ingest({ kind: 'event', ip: '203.0.113.1', bodyText: '\n\n' }, { sink });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { ok: false, error: 'empty_body' });
});

test('an oversized single record is 413 record_too_large; an oversized request is 413 request_too_large', async () => {
  const { sink } = capturingSink();
  const bigRecord = await ingest(req('match', matchRow({ payloadJson: 'x'.repeat(950_000) })), { sink });
  assert.equal(bigRecord.status, 413);
  assert.deepEqual(bigRecord.body, { ok: false, error: 'record_too_large' });

  const bigRequest = await ingest(req('match', matchRow({ payloadJson: 'x'.repeat(1_100_000) })), { sink });
  assert.equal(bigRequest.status, 413);
  assert.deepEqual(bigRequest.body, { ok: false, error: 'request_too_large' });
});

test('a client over its rate limit gets 429', async () => {
  const { sink } = capturingSink();
  const rateLimiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
  assert.equal((await ingest(req('event', { event: 'a' }), { sink, rateLimiter })).status, 200);
  const limited = await ingest(req('event', { event: 'b' }), { sink, rateLimiter });
  assert.equal(limited.status, 429);
  assert.deepEqual(limited.body, { ok: false, error: 'rate_limited' });
});

test('a downstream failure surfaces as 503 (client keeps the record queued)', async () => {
  const { sink } = capturingSink('downstream_error');
  const res = await ingest(req('match', matchRow()), { sink });
  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { ok: false, error: 'downstream_unavailable' });
});
