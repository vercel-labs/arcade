import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { ensureGatewayKey } from './gateway-key.ts';

// Only the precedence short-circuits are exercised here — they resolve before any
// network or login, so no stubbing is needed. The device-flow/token internals are
// covered in vercel-auth.test.ts.
describe('ensureGatewayKey precedence', () => {
  let prev: string | undefined;

  beforeEach(() => {
    prev = process.env.AI_GATEWAY_API_KEY;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = prev;
  });

  test('an existing AI_GATEWAY_API_KEY wins and skips login', async () => {
    process.env.AI_GATEWAY_API_KEY = '  vck_from_env  ';
    const res = await ensureGatewayKey({ interactive: true });
    assert.deepEqual(res, { key: 'vck_from_env', source: 'env' }); // trimmed, no team, no network
  });

  test('returns null when non-interactive with no env key (CI/headless)', async () => {
    delete process.env.AI_GATEWAY_API_KEY;
    const res = await ensureGatewayKey({ interactive: false });
    assert.equal(res, null);
  });
});
