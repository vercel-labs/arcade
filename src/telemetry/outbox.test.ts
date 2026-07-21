import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { RecordOutbox, type FetchLike } from './outbox.ts';
import type { CanonicalRecordRow } from './records.ts';

const row: CanonicalRecordRow = {
  emittedAt: '2026-07-17T10:02:00.000Z',
  sessionId: 'session-1',
  environment: 'prod',
  appVersion: '0.1.1',
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
  startedAt: '2026-07-17T10:00:00.000Z',
  endedAt: '2026-07-17T10:01:00.000Z',
  participantCount: 2,
  actionCount: 20,
  payloadJson: '{"recordType":"match"}',
};

const MATCH_ENDPOINT = 'https://proxy.test/v1/matches';
const POKER_HAND_ENDPOINT = 'https://proxy.test/v1/poker-hands';

function options(directory: string, fetchImpl: FetchLike, enabled = true) {
  return {
    directory,
    enabled,
    endpoints: { match: MATCH_ENDPOINT, poker_hand: POKER_HAND_ENDPOINT },
    fetch: fetchImpl,
    timeoutMs: 1000,
  } as const;
}

test('outbox keeps a mode-0600 record when an acknowledged send fails', async () => {
  const root = mkdtempSync(join(tmpdir(), 'arcade-outbox-'));
  try {
    const outbox = new RecordOutbox(options(root, async () => new Response('', { status: 503 })));
    assert.equal(outbox.enqueue('match', row), true);
    await outbox.drain();
    assert.equal(outbox.queuedCount(), 1);
    const path = join(root, readdirSync(root)[0]);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(statSync(root).mode & 0o777, 0o700);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('outbox posts to the record-type route with no auth header and removes only an HTTP-200 row', async () => {
  const root = mkdtempSync(join(tmpdir(), 'arcade-outbox-'));
  const calls: { url: string; init?: RequestInit }[] = [];
  try {
    const fetchImpl: FetchLike = async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response('', { status: 200 });
    };
    const outbox = new RecordOutbox(options(root, fetchImpl));
    assert.equal(outbox.enqueue('match', row), true);
    await outbox.drain();
    assert.equal(outbox.queuedCount(), 0);
    assert.equal(calls.length, 1);
    // Plain route (no Tinybird wait=true query), no client credential — the proxy is
    // the trust boundary and only 200 means the downstream write was acknowledged.
    assert.equal(calls[0].url, MATCH_ENDPOINT);
    const headers = calls[0].init?.headers as Record<string, string>;
    assert.equal(headers.Authorization, undefined);
    assert.equal(headers['Content-Type'], 'application/x-ndjson');
    assert.match(String(calls[0].init?.body), /"recordId":"record-1"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a 400/413 rejection drops the record instead of retrying it forever', async () => {
  const root = mkdtempSync(join(tmpdir(), 'arcade-outbox-'));
  let calls = 0;
  try {
    const outbox = new RecordOutbox(options(root, async () => {
      calls++;
      return new Response('', { status: 400 });
    }));
    assert.equal(outbox.enqueue('match', row), true);
    await outbox.drain();
    assert.equal(calls, 1);
    assert.equal(outbox.queuedCount(), 0); // dropped, not retained
    await outbox.drain();
    assert.equal(calls, 1); // and never retried
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('disabled outbox writes and sends nothing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'arcade-outbox-'));
  let calls = 0;
  try {
    const outbox = new RecordOutbox(options(root, async () => {
      calls++;
      return new Response('', { status: 200 });
    }, false));
    assert.equal(outbox.enqueue('match', row), false);
    await outbox.drain();
    assert.equal(calls, 0);
    assert.equal(outbox.queuedCount(), 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a newer checkpoint is not deleted when it replaces an in-flight revision', async () => {
  const root = mkdtempSync(join(tmpdir(), 'arcade-outbox-'));
  const bodies: string[] = [];
  let acknowledgeFirst: ((response: Response) => void) | undefined;
  try {
    const outbox = new RecordOutbox(options(root, async (_input, init) => {
      bodies.push(String(init?.body));
      if (bodies.length === 1) return new Promise<Response>((resolve) => { acknowledgeFirst = resolve; });
      return new Response('', { status: 200 });
    }));
    assert.equal(outbox.enqueue('match', row), true);
    while (bodies.length === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(outbox.enqueue('match', { ...row, recordRevision: 2 }), true);
    acknowledgeFirst?.(new Response('', { status: 200 }));
    await outbox.drain();
    assert.equal(bodies.length, 2);
    assert.match(bodies[0], /"recordRevision":1/);
    assert.match(bodies[1], /"recordRevision":2/);
    assert.equal(outbox.queuedCount(), 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a different record added during an active drain is sent in the same drain', async () => {
  const root = mkdtempSync(join(tmpdir(), 'arcade-outbox-'));
  const bodies: string[] = [];
  let acknowledgeFirst: ((response: Response) => void) | undefined;
  try {
    const outbox = new RecordOutbox(options(root, async (_input, init) => {
      bodies.push(String(init?.body));
      if (bodies.length === 1) return new Promise<Response>((resolve) => { acknowledgeFirst = resolve; });
      return new Response('', { status: 200 });
    }));
    assert.equal(outbox.enqueue('match', row), true);
    while (bodies.length === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(outbox.enqueue('match', { ...row, recordId: 'record-2', matchId: 'match-2' }), true);
    acknowledgeFirst?.(new Response('', { status: 200 }));
    await outbox.drain();
    assert.equal(bodies.length, 2);
    assert.match(bodies[1], /"recordId":"record-2"/);
    assert.equal(outbox.queuedCount(), 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
