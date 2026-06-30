import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

// Vercel OAuth 2.0 device-authorization flow (RFC 8628) + on-disk token store.
//
// This mirrors `vercel login`: we run the device flow under the Vercel CLI's
// public OAuth client, which is the one client allow-listed to mint AI Gateway
// keys, so the access token it returns can create a gateway key billed to the
// user's chosen team with no server of our own. The flow is a public client —
// no client secret. Network calls take an injectable `fetch`/`sleep`/`now` so
// the polling state machine is unit-testable.

// Vercel CLI's production OAuth client (device_code + refresh_token grants,
// public client — `none` auth method). Reused deliberately: a fresh client would
// not be allow-listed to create `ai-gateway` keys until the API team adds it.
export const CLIENT_ID = 'cl_HYyOPBNtFMfHhaUn9L4QPfTZz6TP47bp';

const OAUTH_BASE = 'https://api.vercel.com';
const DEVICE_AUTH_URL = `${OAUTH_BASE}/login/oauth/device-authorization`;
const TOKEN_URL = `${OAUTH_BASE}/login/oauth/token`;
// `openid` identifies the user; `offline_access` yields a refresh token so we can
// renew the short-lived access token without sending the user through login again.
const SCOPE = 'openid offline_access';
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const REFRESH_GRANT = 'refresh_token';
// Treat a token as expired this long before its real deadline, to cover clock
// skew and the round-trip of the request it's about to authorize.
const EXPIRY_SKEW_MS = 60_000;

export type Fetch = typeof fetch;
type Sleep = (ms: number) => Promise<void>;

const defaultSleep: Sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// An OAuth error with the spec's machine-readable `error` code, so callers can
// branch (e.g. `invalid_grant` on refresh → fall back to a fresh login).
export class OAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'OAuthError';
  }
}

export interface DeviceAuth {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number; // seconds until device_code expires
  interval: number; // seconds to wait between token polls
}

export interface TokenSet {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in?: number; // seconds
  scope?: string;
}

// What we persist between runs. The minted gateway key is intentionally NOT
// stored — it's re-derived each launch from these tokens (a cheap, idempotent
// exchange) so there's only one long-lived secret on disk.
export interface StoredAuth {
  access_token: string;
  refresh_token?: string;
  expires_at?: number; // epoch ms
  scope?: string;
  team?: { id: string; slug: string; name: string };
  user?: { username: string };
}

function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

// Step 1: ask Vercel for a device + user code. The caller shows `user_code` and
// opens `verification_uri_complete` in a browser.
export async function requestDeviceCode(fetchImpl: Fetch = fetch): Promise<DeviceAuth> {
  const res = await fetchImpl(DEVICE_AUTH_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: form({ client_id: CLIENT_ID, scope: SCOPE }),
  });
  if (!res.ok) {
    const detail = await safeError(res);
    throw new OAuthError(detail.error ?? 'device_authorization_failed', detail.error_description ?? `Could not start login (HTTP ${res.status}).`);
  }
  return (await res.json()) as DeviceAuth;
}

export interface PollOpts {
  intervalSec: number;
  expiresInSec: number;
  fetchImpl?: Fetch;
  sleep?: Sleep;
  now?: () => number;
}

// Step 2: poll the token endpoint until the user approves in the browser. Honors
// the RFC 8628 control errors: `authorization_pending` (keep waiting),
// `slow_down` (back off by 5s). Resolves with tokens, or throws OAuthError on
// denial / expiry / timeout.
export async function pollForToken(deviceCode: string, opts: PollOpts): Promise<TokenSet> {
  const { intervalSec, expiresInSec, fetchImpl = fetch, sleep = defaultSleep, now = Date.now } = opts;
  let interval = Math.max(1, intervalSec) * 1000;
  const deadline = now() + expiresInSec * 1000;

  while (now() < deadline) {
    await sleep(interval);
    const res = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: form({ grant_type: DEVICE_GRANT, device_code: deviceCode, client_id: CLIENT_ID }),
    });
    if (res.ok) return (await res.json()) as TokenSet;

    const { error, error_description } = await safeError(res);
    switch (error) {
      case 'authorization_pending':
        continue; // user hasn't approved yet
      case 'slow_down':
        interval += 5000; // server asked us to ease off
        continue;
      case 'access_denied':
        throw new OAuthError('access_denied', 'Login was denied.');
      case 'expired_token':
        throw new OAuthError('expired_token', 'The login code expired — run login again.');
      default:
        throw new OAuthError(error ?? 'unknown', error_description ?? `Login failed (HTTP ${res.status}).`);
    }
  }
  throw new OAuthError('expired_token', 'Login timed out — run login again.');
}

// Exchange a refresh token for a fresh access token. Throws OAuthError (typically
// `invalid_grant`) when the refresh token is revoked/expired.
export async function refreshAccessToken(refreshToken: string, fetchImpl: Fetch = fetch): Promise<TokenSet> {
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: form({ grant_type: REFRESH_GRANT, refresh_token: refreshToken, client_id: CLIENT_ID }),
  });
  if (!res.ok) {
    const { error, error_description } = await safeError(res);
    throw new OAuthError(error ?? 'refresh_failed', error_description ?? `Could not refresh session (HTTP ${res.status}).`);
  }
  return (await res.json()) as TokenSet;
}

// Convert a freshly-issued TokenSet into the persisted shape, computing an
// absolute expiry. `prev` carries a refresh token forward when a refresh
// response omits it (the spec allows reusing the existing one).
export function toStoredAuth(tok: TokenSet, prev?: StoredAuth): StoredAuth {
  return {
    access_token: tok.access_token,
    refresh_token: tok.refresh_token ?? prev?.refresh_token,
    expires_at: tok.expires_in ? Date.now() + tok.expires_in * 1000 : undefined,
    scope: tok.scope ?? prev?.scope,
    team: prev?.team,
    user: prev?.user,
  };
}

export function isExpired(auth: StoredAuth, now: () => number = Date.now): boolean {
  return !auth.expires_at || now() > auth.expires_at - EXPIRY_SKEW_MS;
}

// ---- token store (~/.config/arcade/auth.json, honoring XDG_CONFIG_HOME) ----

export function authPath(): string {
  const base = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config');
  return join(base, 'arcade', 'auth.json');
}

export function readAuth(): StoredAuth | null {
  try {
    const parsed = JSON.parse(readFileSync(authPath(), 'utf8')) as StoredAuth;
    return parsed.access_token ? parsed : null;
  } catch {
    return null; // absent or unreadable — treat as logged out
  }
}

// Persist tokens with owner-only permissions: dir 0700, file 0600. chmod after
// write covers the case where the file already existed with looser bits.
export function writeAuth(auth: StoredAuth): void {
  const path = authPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(auth, null, 2), { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function clearAuth(): void {
  rmSync(authPath(), { force: true });
}

async function safeError(res: Response): Promise<{ error?: string; error_description?: string }> {
  try {
    return (await res.json()) as { error?: string; error_description?: string };
  } catch {
    return {};
  }
}
