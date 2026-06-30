import { createInterface } from 'node:readline/promises';
import { openBrowser } from '../platform/open-browser.ts';
import {
  clearAuth,
  isExpired,
  OAuthError,
  pollForToken,
  readAuth,
  refreshAccessToken,
  requestDeviceCode,
  type StoredAuth,
  toStoredAuth,
  writeAuth,
} from './vercel-auth.ts';
import { createGatewayKey, getUser, listTeams, type Team } from './vercel-api.ts';

// Resolves the AI Gateway key the rest of the arcade reads from
// `process.env.AI_GATEWAY_API_KEY`. The whole interactive flow (device login +
// team pick) is plain text on the normal terminal — main.ts runs it BEFORE
// entering the alt-screen, so it reads like `vercel login`. Once resolved, every
// existing model/voice call works unchanged because they all read the env var.

const ENV_KEY = 'AI_GATEWAY_API_KEY';
const KEY_NAME = 'Arcade';

const bold = (s: string): string => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string): string => `\x1b[2m${s}\x1b[0m`;
const green = (s: string): string => `\x1b[32m${s}\x1b[0m`;
const out = (s = ''): void => void process.stdout.write(`${s}\n`);

export interface EnsureOpts {
  /** Re-run the browser login even if a stored session exists (`--login`). */
  forceLogin?: boolean;
  /** Re-prompt for the team even if one is already chosen (`--switch-team`). */
  forceTeamPick?: boolean;
  /** Whether we can prompt. Defaults to stdin being a TTY. */
  interactive?: boolean;
}

export interface EnsureResult {
  key: string;
  source: 'env' | 'login';
  team?: Team;
}

export function isLoggedIn(): boolean {
  return readAuth() !== null;
}

// Startup entry point. Precedence: an existing AI_GATEWAY_API_KEY wins (CI /
// power users / a pasted .env key); otherwise we use the stored Vercel session
// (refreshing or re-logging in as needed), pick a team, and mint a key. Returns
// null when no key could be obtained (non-interactive with no env key, or the
// user backed out) — the arcade still runs, just with AI gated.
export async function ensureGatewayKey(opts: EnsureOpts = {}): Promise<EnsureResult | null> {
  const interactive = opts.interactive ?? !!process.stdin.isTTY;

  const envKey = process.env[ENV_KEY]?.trim();
  if (envKey && !opts.forceLogin && !opts.forceTeamPick) return { key: envKey, source: 'env' };

  if (!interactive) return null; // can't run the browser flow without a TTY

  try {
    const auth = await ensureSession(opts.forceLogin ?? false);
    const team = await ensureTeam(auth, opts.forceTeamPick ?? false);
    const key = await mintKey(auth, team);
    return { key, source: 'login', team };
  } catch (err) {
    out();
    out(`  Vercel sign-in skipped: ${errMessage(err)}`);
    out(dim('  Playing without AI — sign in later, or set AI_GATEWAY_API_KEY.'));
    out();
    return null;
  }
}

// Force a team re-pick from inside the arcade (the in-app "switch team" action).
// Logs in first if needed. Returns null on any failure/back-out.
export async function switchTeam(): Promise<EnsureResult | null> {
  try {
    const auth = await ensureSession(false);
    const team = await ensureTeam(auth, true);
    const key = await mintKey(auth, team);
    return { key, source: 'login', team };
  } catch (err) {
    out(`  Could not switch team: ${errMessage(err)}`);
    return null;
  }
}

// Delete the stored session and drop the key from this process so AI re-gates.
// Returns whether a session was actually present.
export function signOut(): boolean {
  const was = isLoggedIn();
  clearAuth();
  delete process.env[ENV_KEY];
  return was;
}

// ---- internals ----

// Yield a usable session: a fresh stored token (refreshed if expired), or a new
// login. Persists whatever it ends up with.
async function ensureSession(forceLogin: boolean): Promise<StoredAuth> {
  let auth = forceLogin ? null : readAuth();

  if (auth && isExpired(auth)) {
    if (auth.refresh_token) {
      try {
        const refreshed = toStoredAuth(await refreshAccessToken(auth.refresh_token), auth);
        writeAuth(refreshed);
        auth = refreshed;
      } catch {
        auth = null; // refresh token revoked/expired — fall through to a fresh login
      }
    } else {
      auth = null;
    }
  }

  if (!auth) auth = await login();
  return auth;
}

// The device-authorization flow, rendered as plain text.
async function login(): Promise<StoredAuth> {
  const device = await requestDeviceCode();
  const url = device.verification_uri_complete ?? device.verification_uri;

  out();
  out(bold('  Sign in to Vercel'));
  out('  A browser window will open. If it doesn’t, visit:');
  out(`    ${bold(device.verification_uri)}`);
  out(`  and enter the code:  ${bold(device.user_code)}`);
  out();
  out(dim('  Waiting for you to authorize…'));
  openBrowser(url);

  const tokens = await pollForToken(device.device_code, {
    intervalSec: device.interval,
    expiresInSec: device.expires_in,
  });
  const auth = toStoredAuth(tokens);
  const user = await getUser(auth.access_token);
  if (user?.username) auth.user = { username: user.username }; // persisted → key name + skips a refetch later
  writeAuth(auth);

  out(green(`  ✓ Signed in${user ? ` as ${user.username}` : ''}.`));
  return auth;
}

// Yield the team to bill against: the stored one, or a fresh pick. Persists the
// choice so later launches skip straight to minting.
async function ensureTeam(auth: StoredAuth, forcePick: boolean): Promise<Team> {
  if (auth.team && !forcePick) return auth.team;

  const teams = await listTeams(auth.access_token);
  if (teams.length === 0) {
    throw new Error('your Vercel account has no teams — create one at vercel.com to use a gateway key');
  }
  const team = teams.length === 1 ? soleTeam(teams[0]!) : await pickTeam(teams);
  auth.team = team;
  writeAuth(auth);
  return team;
}

function soleTeam(team: Team): Team {
  out(`  Using team ${bold(team.name)}.`);
  return team;
}

// Plain-text numbered picker. Re-prompts on bad input; Ctrl+D/empty after the
// retry budget throws (caught upstream → AI just stays gated).
async function pickTeam(teams: Team[]): Promise<Team> {
  out();
  out(bold('  Select a team to bill AI Gateway usage to:'));
  teams.forEach((t, i) => out(`    ${String(i + 1).padStart(2)}. ${t.name}${t.slug !== t.name ? dim(`  (${t.slug})`) : ''}`));
  out();

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const answer = (await rl.question(`  Team [1-${teams.length}]: `)).trim();
      const n = Number(answer);
      if (Number.isInteger(n) && n >= 1 && n <= teams.length) return teams[n - 1]!;
      out(dim('  Enter the number next to a team.'));
    }
    throw new Error('no team selected');
  } finally {
    rl.close();
  }
}

// The signed-in user's handle, for attributing the key's name. Cached in the
// token store; backfilled (best-effort) for sessions that predate it.
async function ensureUsername(auth: StoredAuth): Promise<string | undefined> {
  if (auth.user?.username) return auth.user.username;
  const user = await getUser(auth.access_token);
  if (user?.username) {
    auth.user = { username: user.username };
    writeAuth(auth);
    return user.username;
  }
  return undefined; // anonymous fetch failed — fall back to the bare name
}

async function mintKey(auth: StoredAuth, team: Team): Promise<string> {
  const username = await ensureUsername(auth);
  // Name only takes effect on the create branch of exchange (get-or-create); an
  // existing key keeps its original name. Matches the playground's "(<user>)" form.
  const name = username ? `${KEY_NAME} (${username})` : KEY_NAME;
  const key = await createGatewayKey(auth.access_token, team.id, name);
  process.env[ENV_KEY] = key;
  out(green(`  ✓ AI Gateway ready — billed to ${team.name}.`));
  out();
  return key;
}

function errMessage(err: unknown): string {
  if (err instanceof OAuthError) return err.message;
  return err instanceof Error ? err.message : String(err);
}
