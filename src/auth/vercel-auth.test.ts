import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  authPath,
  clearAuth,
  isExpired,
  OAuthError,
  pollForToken,
  readAuth,
  refreshAccessToken,
  type StoredAuth,
  toStoredAuth,
  writeAuth,
} from './vercel-auth.ts';

// A fetch stub that replays a queued sequence of Responses in order.
function seq(responses: Response[]): { fn: typeof fetch; count: () => number } {
  let calls = 0;
  const fn = (async () => {
    const res = responses[calls++];
    if (!res) throw new Error('seq: more calls than queued responses');
    return res;
  }) as unknown as typeof fetch;
  return { fn, count: () => calls };
}

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });

describe('pollForToken', () => {
  test('returns tokens after authorization_pending', async () => {
    const slept: number[] = [];
    const { fn } = seq([
      json({ error: 'authorization_pending' }, 400),
      json({ access_token: 'vca_ok', token_type: 'Bearer', expires_in: 3600 }),
    ]);
    const tokens = await pollForToken('dc', {
      intervalSec: 5,
      expiresInSec: 600,
      fetchImpl: fn,
      sleep: async (ms) => void slept.push(ms),
      now: () => 1000, // constant; well inside the deadline
    });
    assert.equal(tokens.access_token, 'vca_ok');
    assert.deepEqual(slept, [5000, 5000]); // polled twice at the 5s interval
  });

  test('slow_down backs the interval off by 5s', async () => {
    const slept: number[] = [];
    const { fn } = seq([
      json({ error: 'slow_down' }, 400),
      json({ access_token: 'vca_ok', token_type: 'Bearer' }),
    ]);
    await pollForToken('dc', {
      intervalSec: 5,
      expiresInSec: 600,
      fetchImpl: fn,
      sleep: async (ms) => void slept.push(ms),
      now: () => 0,
    });
    assert.deepEqual(slept, [5000, 10000]);
  });

  test('access_denied throws a typed OAuthError', async () => {
    const { fn } = seq([json({ error: 'access_denied' }, 400)]);
    await assert.rejects(
      () => pollForToken('dc', { intervalSec: 1, expiresInSec: 600, fetchImpl: fn, sleep: async () => {}, now: () => 0 }),
      (err: unknown) => err instanceof OAuthError && err.code === 'access_denied',
    );
  });

  test('times out once the deadline passes', async () => {
    // now() advances 250s per call; with a 600s window the loop gives up.
    let t = 0;
    const { fn } = seq([json({ error: 'authorization_pending' }, 400), json({ error: 'authorization_pending' }, 400), json({ error: 'authorization_pending' }, 400)]);
    await assert.rejects(
      () =>
        pollForToken('dc', {
          intervalSec: 1,
          expiresInSec: 600,
          fetchImpl: fn,
          sleep: async () => {},
          now: () => {
            const v = t;
            t += 250_000;
            return v;
          },
        }),
      (err: unknown) => err instanceof OAuthError && err.code === 'expired_token',
    );
  });
});

describe('refreshAccessToken', () => {
  test('returns the new token set on success', async () => {
    const { fn } = seq([json({ access_token: 'vca_new', token_type: 'Bearer', expires_in: 3600 })]);
    const tok = await refreshAccessToken('vcr_old', fn);
    assert.equal(tok.access_token, 'vca_new');
  });

  test('throws OAuthError(invalid_grant) when the refresh token is rejected', async () => {
    const { fn } = seq([json({ error: 'invalid_grant', error_description: 'expired' }, 400)]);
    await assert.rejects(() => refreshAccessToken('vcr_dead', fn), (err: unknown) => err instanceof OAuthError && err.code === 'invalid_grant');
  });
});

describe('toStoredAuth + isExpired', () => {
  test('computes an absolute expiry and carries refresh token + team + user forward', () => {
    const prev: StoredAuth = {
      access_token: 'old',
      refresh_token: 'vcr_keep',
      team: { id: 't', slug: 's', name: 'n' },
      user: { username: 'brian' },
    };
    const before = Date.now();
    const stored = toStoredAuth({ access_token: 'new', token_type: 'Bearer', expires_in: 3600 }, prev);
    assert.equal(stored.access_token, 'new');
    assert.equal(stored.refresh_token, 'vcr_keep'); // omitted by refresh response → reused
    assert.deepEqual(stored.team, prev.team);
    assert.deepEqual(stored.user, prev.user); // survives a token refresh
    assert.ok(stored.expires_at! >= before + 3600_000 - 50);
  });

  test('isExpired is true within the skew window and false well before', () => {
    assert.equal(isExpired({ access_token: 'a', expires_at: Date.now() + 5_000 }), true); // inside 60s skew
    assert.equal(isExpired({ access_token: 'a', expires_at: Date.now() + 3600_000 }), false);
    assert.equal(isExpired({ access_token: 'a' }), true); // no expiry → treat as expired
  });
});

describe('token store', () => {
  let dir: string;
  let prevXdg: string | undefined;

  beforeEach(() => {
    prevXdg = process.env.XDG_CONFIG_HOME;
    dir = mkdtempSync(join(tmpdir(), 'arcade-auth-'));
    process.env.XDG_CONFIG_HOME = dir;
  });

  afterEach(() => {
    if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prevXdg;
    rmSync(dir, { recursive: true, force: true });
  });

  test('writes under XDG_CONFIG_HOME/arcade and round-trips', () => {
    assert.equal(authPath(), join(dir, 'arcade', 'auth.json'));
    assert.equal(readAuth(), null); // nothing yet

    const auth: StoredAuth = { access_token: 'vca_x', refresh_token: 'vcr_y', team: { id: 'team_1', slug: 'acme', name: 'Acme' } };
    writeAuth(auth);
    assert.deepEqual(readAuth(), auth);
  });

  test('persists the file with owner-only (0600) permissions', { skip: process.platform === 'win32' }, () => {
    writeAuth({ access_token: 'vca_x' });
    assert.equal(statSync(authPath()).mode & 0o777, 0o600);
  });

  test('clearAuth removes the session (idempotent)', () => {
    writeAuth({ access_token: 'vca_x' });
    clearAuth();
    assert.equal(readAuth(), null);
    clearAuth(); // no throw when already gone
  });
});
