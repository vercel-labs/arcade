import assert from 'node:assert/strict';
import test from 'node:test';
import { createKvRateLimiter, createMemoryRateLimiter } from './rate-limit.ts';

test('memory limiter allows up to the limit, then limits, then rolls the window', async () => {
  let t = 0;
  const rl = createMemoryRateLimiter({ limit: 2, windowMs: 1000, now: () => t });
  assert.equal(await rl.check('a'), 'ok');
  assert.equal(await rl.check('a'), 'ok');
  assert.equal(await rl.check('a'), 'limited');
  assert.equal(await rl.check('b'), 'ok'); // independent key
  t = 1000;
  assert.equal(await rl.check('a'), 'ok'); // window rolled
});

const kvFetch = (result: (url: string) => unknown): typeof fetch =>
  (async (u: string) => new Response(JSON.stringify({ result: result(String(u)) }), { status: 200 })) as unknown as typeof fetch;

test('kv limiter blocks when a block:<key> entry exists', async () => {
  const rl = createKvRateLimiter({ url: 'https://kv.test', token: 'x', limit: 5, windowSec: 60, fetchImpl: kvFetch((u) => (u.includes('/get/') ? 1 : 0)) });
  assert.equal(await rl.check('ip'), 'blocked');
});

test('kv limiter limits when the counter exceeds the window limit', async () => {
  const rl = createKvRateLimiter({ url: 'https://kv.test', token: 'x', limit: 5, windowSec: 60, fetchImpl: kvFetch((u) => (u.includes('/get/') ? null : 6)) });
  assert.equal(await rl.check('ip'), 'limited');
});

test('kv limiter passes under the limit', async () => {
  const rl = createKvRateLimiter({ url: 'https://kv.test', token: 'x', limit: 5, windowSec: 60, fetchImpl: kvFetch((u) => (u.includes('/get/') ? null : 1)) });
  assert.equal(await rl.check('ip'), 'ok');
});

test('kv limiter fails open on a KV error', async () => {
  const rl = createKvRateLimiter({ url: 'https://kv.test', token: 'x', limit: 5, windowSec: 60, fetchImpl: (async () => new Response('err', { status: 500 })) as unknown as typeof fetch });
  assert.equal(await rl.check('ip'), 'ok');
});
