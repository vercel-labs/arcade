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
const HOSTED_TERMINAL_ENV = 'ARCADE_HOSTED_TERMINAL';
const HOSTED_DEMO_KEY_ENV = 'ARCADE_HOSTED_DEMO_KEY';
const KEY_NAME = 'Arcade';

const bold = (s: string): string => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string): string => `\x1b[2m${s}\x1b[0m`;
const status = (s: string): string => `\x1b[38;2;135;135;175m${s}\x1b[0m`;
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
  team?: Team;
}

export interface AvailableTeamsResult {
  teams: Team[];
  current: Team | null;
  username?: string;
}

export function isLoggedIn(): boolean {
  return readAuth() !== null || (process.env[HOSTED_TERMINAL_ENV] !== '1' && hostedTerminalKey() !== null);
}

// Non-interactive entry point for Arcade's terminal tools. Reuses the cached
// Vercel OAuth session and its selected team, refreshes the session if needed,
// and mints the same process-local key as the full Arcade. It never reads an
// inherited AI_GATEWAY_API_KEY and never opens a browser or team picker.
export async function ensureCachedGatewayKey(): Promise<EnsureResult | null> {
  const auth = await cachedSession();
  if (!auth?.team) return null;
  const key = await mintKey(auth, auth.team, true);
  return { key, team: auth.team };
}

// Startup entry point. Arcade launches always use the stored Vercel session
// (refreshing or re-logging in as needed), pick a team, and mint a key. A
// pre-set AI_GATEWAY_API_KEY is deliberately ignored; this prevents an
// unrelated shell credential from silently changing which team is billed.
// Returns null when no key could be obtained — the arcade still runs, just with
// AI gated.
export async function ensureGatewayKey(opts: EnsureOpts = {}): Promise<EnsureResult | null> {
  const hostedKey = hostedTerminalKey();
  if (hostedKey && !opts.forceLogin) return { key: hostedKey };

  const interactive = opts.interactive ?? !!process.stdin.isTTY;

  if (!interactive) return null; // can't run the browser flow without a TTY

  try {
    const auth = await ensureSession(opts.forceLogin ?? false);
    const team = await ensureTeam(auth, opts.forceTeamPick ?? false);
    const key = await mintKey(auth, team);
    return { key, team };
  } catch (err) {
    out();
    out(`  Vercel sign-in skipped: ${errMessage(err)}`);
    out(dim('  Playing without AI — sign in later to enable model play.'));
    out();
    return null;
  }
}

// Sign in as a different Vercel user without destroying the working session first.
// The new OAuth tokens remain staged in memory until a billing team is selected and
// its Gateway key is successfully minted. Cancelling or failing at any point leaves
// both the stored account and the process-local key untouched.
export async function signInWithAnotherAccount(): Promise<EnsureResult | null> {
  const preserveExistingSession = readAuth() !== null;
  const previousKey = process.env[ENV_KEY];
  try {
    const auth = await login(!preserveExistingSession);
    const team = await ensureTeam(auth, true, !preserveExistingSession);
    const key = await mintKey(auth, team, false, !preserveExistingSession);
    writeAuth(auth);
    return { key, team };
  } catch (err) {
    if (previousKey === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = previousKey;
    out(`  Could not change account: ${errMessage(err)}`);
    return null;
  }
}

// The teams the signed-in user can switch between, plus the team currently billed.
// For the in-app modal team picker (the menu's settings gear), which needs the raw
// list to render without prompting or printing. Returns null
// when there's no usable session (not signed in), so the caller can offer sign-in.
export async function availableTeams(): Promise<AvailableTeamsResult | null> {
  const auth = await cachedSession('if-current');
  if (!auth) return null;
  const teams = await listTeams(auth.access_token);
  return { teams, current: auth.team ?? null, username: await ensureUsername(auth, false) };
}

// Stage a team chosen in the in-app modal and commit it only while the owning UI operation is
// still current. Key creation may finish after sign-out; the predicate prevents that stale result
// from restoring auth or AI_GATEWAY_API_KEY. The one-argument overload remains convenient for
// non-interactive tools whose call is their whole operation.
export async function useTeam(team: Team): Promise<EnsureResult>;
export async function useTeam(team: Team, isCurrent: () => boolean): Promise<EnsureResult | null>;
export async function useTeam(team: Team, isCurrent: () => boolean = () => true): Promise<EnsureResult | null> {
  const auth = await cachedSession('if-current');
  if (!auth) throw new Error('not signed in');
  const candidate: StoredAuth = { ...auth, team, ...(auth.user ? { user: { ...auth.user } } : {}) };
  const key = await mintKey(candidate, team, true, false, false);
  if (!isCurrent()) return null;
  writeAuth(candidate);
  process.env[ENV_KEY] = key;
  return { key, team };
}

// Delete the stored session and drop the key from this process so AI re-gates.
// Returns whether a session was actually present.
export function signOut(): boolean {
  const was = isLoggedIn();
  clearAuth();
  const hostedDemoKey = process.env[HOSTED_DEMO_KEY_ENV]?.trim();
  if (hostedDemoKey) process.env[ENV_KEY] = hostedDemoKey;
  else delete process.env[ENV_KEY];
  return was;
}

function hostedTerminalKey(): string | null {
  if (process.env[HOSTED_TERMINAL_ENV] !== '1') return null;
  return process.env[ENV_KEY]?.trim() || null;
}

// ---- internals ----

// Yield a usable session: a fresh stored token (refreshed if expired), or a new
// login. Persists whatever it ends up with.
async function ensureSession(forceLogin: boolean): Promise<StoredAuth> {
  let auth = forceLogin ? null : await cachedSession();
  if (!auth) auth = await login();
  return auth;
}

// Yield a fresh cached session without ever starting interactive login.
async function cachedSession(persist: boolean | 'if-current' = true): Promise<StoredAuth | null> {
  const auth = readAuth();
  if (!auth) return null;
  if (!isExpired(auth)) return auth;
  if (!auth.refresh_token) return null;
  try {
    const refreshed = toStoredAuth(await refreshAccessToken(auth.refresh_token), auth);
    const current = persist === 'if-current' ? readAuth() : null;
    const unchanged = current !== null
      && current.access_token === auth.access_token
      && current.refresh_token === auth.refresh_token;
    if (persist === true || (persist === 'if-current' && unchanged)) writeAuth(refreshed);
    return refreshed;
  } catch {
    return null;
  }
}

// The device-authorization flow, rendered as plain text.
async function login(persist = true): Promise<StoredAuth> {
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
  if (persist) writeAuth(auth);

  if (persist) out(status(`  ✓ Signed in${user ? ` as ${user.username}` : ''}.`));
  return auth;
}

// Yield the team to bill against: the stored one, or a fresh pick. Persists the
// choice so later launches skip straight to minting.
async function ensureTeam(auth: StoredAuth, forcePick: boolean, persist = true): Promise<Team> {
  if (auth.team && !forcePick) return auth.team;

  const teams = await listTeams(auth.access_token);
  if (teams.length === 0) {
    throw new Error('your Vercel account has no teams — create one at vercel.com to use a gateway key');
  }
  const team = teams.length === 1 ? soleTeam(teams[0]!) : await pickTeam(teams);
  auth.team = team;
  if (persist) writeAuth(auth);
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
async function ensureUsername(auth: StoredAuth, persist = true): Promise<string | undefined> {
  if (auth.user?.username) return auth.user.username;
  const user = await getUser(auth.access_token);
  if (user?.username) {
    auth.user = { username: user.username };
    if (persist) writeAuth(auth);
    return user.username;
  }
  return undefined; // anonymous fetch failed — fall back to the bare name
}

// `quiet` skips the success lines — set when minting from inside the live TUI
// (the in-app modal), where any stdout write would corrupt the alt-screen.
async function mintKey(auth: StoredAuth, team: Team, quiet = false, persist = true, install = true): Promise<string> {
  const username = await ensureUsername(auth, persist);
  // Name only takes effect on the create branch of exchange (get-or-create); an
  // existing key keeps its original name. Matches the playground's "(<user>)" form.
  const name = username ? `${KEY_NAME} (${username})` : KEY_NAME;
  const key = await createGatewayKey(auth.access_token, team.id, name);
  if (install) process.env[ENV_KEY] = key;
  if (!quiet) {
    out(status(`  ✓ AI Gateway ready. Billed to ${team.name}.`));
    out();
  }
  return key;
}

function errMessage(err: unknown): string {
  if (err instanceof OAuthError) return err.message;
  return err instanceof Error ? err.message : String(err);
}
