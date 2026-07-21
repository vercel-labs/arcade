import assert from 'node:assert/strict';
import test from 'node:test';
import { consoleSink, createTinybirdSink } from './sink.ts';

const DS = { event: 'e', match: 'm', poker_hand: 'p' };
const okResponse = (obj: unknown, status = 200): Response => new Response(JSON.stringify(obj), { status });

test('tinybird sink posts one wait=true NDJSON call and acks a committed write', async () => {
  let url = '';
  let body = '';
  const sink = createTinybirdSink({
    token: 'tok', host: 'https://tb.test/', datasource: DS,
    fetchImpl: (async (u: string, init: RequestInit) => {
      url = String(u); body = String(init.body);
      return okResponse({ successful_rows: 2, quarantined_rows: 0 });
    }) as unknown as typeof fetch,
  });
  const res = await sink.deliver('match', [{ recordId: 'r1' }, { recordId: 'r2' }]);
  assert.equal(res, 'ok');
  assert.equal(url, 'https://tb.test/v0/events?name=m&wait=true');
  assert.equal(body, '{"recordId":"r1"}\n{"recordId":"r2"}'); // one call, NDJSON
});

test('tinybird sink fails when any row is quarantined (schema drift)', async () => {
  const sink = createTinybirdSink({
    token: 'tok', host: 'https://tb.test', datasource: DS,
    fetchImpl: (async () => okResponse({ successful_rows: 0, quarantined_rows: 1 })) as unknown as typeof fetch,
  });
  assert.equal(await sink.deliver('match', [{}]), 'downstream_error');
});

test('tinybird sink fails on a non-2xx response', async () => {
  const sink = createTinybirdSink({
    token: 'tok', host: 'https://tb.test', datasource: DS,
    fetchImpl: (async () => new Response('nope', { status: 403 })) as unknown as typeof fetch,
  });
  assert.equal(await sink.deliver('event', [{}]), 'downstream_error');
});

test('consoleSink logs only counts, never record payloads', async () => {
  const logs: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); };
  try {
    const result = await consoleSink.deliver('match', [{ payloadJson: 'SENTINEL_SECRET_MOVE_TEXT' }]);
    assert.equal(result, 'ok');
  } finally {
    console.log = original;
  }
  assert.equal(logs.length, 1);
  assert.match(logs[0], /"count":1/);
  assert.match(logs[0], /"kind":"match"/);
  assert.doesNotMatch(logs[0], /SENTINEL_SECRET_MOVE_TEXT/); // payloads never reach logs
});
