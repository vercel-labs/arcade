// Anonymous telemetry for the arcade CLI. Lightweight usage events are detached
// fire-and-forget POSTs; canonical game records use an acknowledged local outbox. Both
// go to the Arcade telemetry proxy — a hosted Vercel service that holds the only
// credential and forwards into ClickHouse — so the published client ships no token or key.
//
// Two hard rules: it never blocks the UI (fire-and-forget, short timeout) and it never
// throws (every failure is swallowed). Analytics must not degrade the app.
//
// Configuration (env, resolved once at import):
//   ARCADE_TELEMETRY=0             opt out entirely (also: off/false/no)
//   ARCADE_TELEMETRY_ENDPOINT=...  override the proxy base URL (a local mock or preview);
//                                  ingest routes /v1/events, /v1/matches, /v1/poker-hands
//                                  hang off it
//
// A local checkout (ARCADE_DEV=1 — pnpm dev/watch/snapshot) sends nothing unless an
// endpoint is set explicitly, so development never writes to the production pipeline.

import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RecordOutbox } from './outbox.ts';
import {
  recordTarget,
  toCanonicalRecordRow,
  type CanonicalGameRecord,
  type ChessMatchRecord,
  type PokerHandRecord,
  type PokerMatchRecord,
} from './records.ts';

export * from './records.ts';

// The hosted Arcade telemetry proxy. The three ingest routes hang off this base; override
// it via env to target a local mock or a preview deployment.
const DEFAULT_ENDPOINT = 'https://arcade-telemetry.vercel.app';
const SEND_TIMEOUT_MS = 2000;
const NOTICE_VERSION = 2;

const optedOut = /^(0|off|false|no)$/i.test(process.env.ARCADE_TELEMETRY?.trim() ?? '');
const endpointOverride = process.env.ARCADE_TELEMETRY_ENDPOINT?.trim() || '';
const base = (endpointOverride || DEFAULT_ENDPOINT).replace(/\/+$/, '');
const eventsEndpoint = `${base}/v1/events`;
const matchEndpoint = `${base}/v1/matches`;
const pokerHandEndpoint = `${base}/v1/poker-hands`;
const env: 'dev' | 'prod' = process.env.ARCADE_DEV === '1' ? 'dev' : 'prod';
// No token — the proxy is the trust boundary. A local checkout (env 'dev') stays silent
// unless an endpoint is set, so only published installs write to the real pipeline.
const enabled = !optedOut && (env === 'prod' || endpointOverride !== '');

// Stamped on every event so any of them can be sliced by run / install / build / env.
const sessionId = randomUUID();
const version = readVersion();
let installId = '';

// In-flight sends, so quit can best-effort drain them (see flushTelemetry).
const pending = new Set<Promise<unknown>>();

function readVersion(): string {
  try {
    const p = fileURLToPath(new URL('../../package.json', import.meta.url));
    return (JSON.parse(readFileSync(p, 'utf8')) as { version?: string }).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

// Anonymous install id + the one-time-notice flag, next to the auth token store.
function configPath(): string {
  const base = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config');
  return join(base, 'arcade', 'telemetry.json');
}
function outboxPath(): string {
  return join(dirname(configPath()), 'telemetry-outbox');
}
interface Store {
  installId: string;
  noticeShownAt?: string;
  noticeVersion?: number;
}
function readStore(): Store | null {
  try {
    return JSON.parse(readFileSync(configPath(), 'utf8')) as Store;
  } catch {
    return null;
  }
}
function writeStore(store: Store): void {
  try {
    const path = configPath();
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, JSON.stringify(store, null, 2), { mode: 0o600 });
    chmodSync(path, 0o600);
  } catch {
    // best-effort — a read-only home shouldn't break launch
  }
}

// Resolve the stable anonymous install id and, when telemetry is active, print a single
// opt-out notice the first time ever. Plain text — call BEFORE entering the alt-screen.
// Safe (and cheap) to call when disabled: it still assigns a stable id so a later
// enable is consistent, but prints and sends nothing.
export function initTelemetry(): void {
  let store = readStore();
  if (!store?.installId) {
    store = { ...(store ?? {}), installId: randomUUID() };
    writeStore(store);
  }
  installId = store.installId;
  if (optedOut) {
    recordOutbox.discardAll();
    return;
  }
  if (!enabled) return;
  if ((store.noticeVersion ?? 0) < NOTICE_VERSION) {
    process.stdout.write(
      '\x1b[38;2;135;135;175m  ✓ Arcade sends anonymous usage + game records (moves, actions, dealt cards; never prompts, chat, voice, or account identity). Opt out: ARCADE_TELEMETRY=0\x1b[0m\n',
    );
    writeStore({ ...store, noticeShownAt: new Date().toISOString(), noticeVersion: NOTICE_VERSION });
  }
  void recordOutbox.drain();
}

const recordOutbox = new RecordOutbox({
  directory: outboxPath(),
  enabled,
  endpoints: { match: matchEndpoint, poker_hand: pokerHandEndpoint },
});

export type TelemetryEvent = { event: string } & Record<string, unknown>;

// Lets game owners avoid constructing canonical records when telemetry is dormant or
// explicitly disabled. This keeps the no-token/opt-out path at effectively zero cost.
export function isTelemetryEnabled(): boolean {
  return enabled;
}

// Fire-and-forget: enqueue one NDJSON row to the proxy. Returns immediately; the POST
// runs detached with a hard timeout and every error is swallowed.
export function track(event: TelemetryEvent): void {
  if (!enabled) return;
  const row =
    JSON.stringify({
      ...event,
      sessionId,
      installId,
      environment: env,
      appVersion: version,
      timestamp: new Date().toISOString(),
    }) + '\n';
  const send = fetch(eventsEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-ndjson' },
    body: row,
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    keepalive: true,
  })
    .catch(() => {})
    .finally(() => pending.delete(send));
  pending.add(send);
}

// Best-effort drain of in-flight sends on shutdown, capped so quit is never noticeably
// delayed. Resolves when everything has settled or the cap elapses, whichever is first.
export async function flushTelemetry(capMs = 500): Promise<void> {
  const work: Promise<unknown>[] = [...pending, recordOutbox.drain()];
  if (work.length === 0) return;
  await Promise.race([Promise.allSettled(work), new Promise((resolve) => setTimeout(resolve, capMs))]);
}

// ---- typed event helpers (keep field names consistent across call sites) ----

export function trackSessionStart(info: { colorMode: string; authed: boolean; cols: number; rows: number }): void {
  track({ event: 'session_start', node: process.versions.node, ...info });
}

// A model or 'human' per seat. `mode` summarizes the table (e.g. ai_vs_ai / human_vs_ai).
export function trackMatchStarted(info: { game: string; mode: string; models: string[]; humans: number; stack?: number }): void {
  track({ event: 'match_started', ...info });
}

// `winner` is the winning model slug, 'human', or 'draw'.
export function trackMatchEnded(info: { game: string; mode: string; models: string[]; winner: string }): void {
  track({ event: 'match_ended', ...info });
}

// One poker hand settled: the seat(s) that took chips and the pot they collected.
export function trackHandEnded(info: { game: string; winners: string[]; pot: number }): void {
  track({ event: 'hand_ended', ...info });
}

// The resilient fallback ladder bottomed out: this model couldn't produce a usable move.
export function trackModelFallback(info: { game: string; model: string; reason: 'exhausted' | 'unavailable' }): void {
  track({ event: 'model_fallback', ...info });
}

// Canonical records use their own acknowledged, disk-backed path. The stable id and
// revision come from the game owner so retries and recovered partial records converge.
// Raw records omit the install id; only the per-run session links them operationally.
export function trackGameRecord(record: CanonicalGameRecord): boolean {
  if (!enabled) return false;
  const row = toCanonicalRecordRow(record, { session: sessionId, env, appVersion: version });
  if (!row) return false;
  return recordOutbox.enqueue(recordTarget(record), row);
}

export function trackMatchRecord(record: ChessMatchRecord | PokerMatchRecord): boolean {
  return trackGameRecord(record);
}

export function trackPokerHandRecord(record: PokerHandRecord): boolean {
  return trackGameRecord(record);
}
