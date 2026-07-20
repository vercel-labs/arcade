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

function options(directory: string, fetchImpl: FetchLike, enabled = true) {
  return {
    directory,
    enabled,
    token: 'append-token',
    endpoints: { match: 'https://tinybird.test/v0/events?name=matches', poker_hand: 'https://tinybird.test/v0/events?name=hands' },
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

test('outbox requests wait=true and removes only an HTTP-200 acknowledged row', async () => {
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
    assert.equal(new URL(calls[0].url).searchParams.get('wait'), 'true');
    assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, 'Bearer append-token');
    assert.match(String(calls[0].init?.body), /"recordId":"record-1"/);
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
