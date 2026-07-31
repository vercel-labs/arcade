// Update notifier: compare the running version against the latest published on the
// npm registry and, if older, surface how to upgrade. The check at launch is fully
// synchronous — it reads a small cache file written by a previous run's background
// refresh — so it never blocks the boot on the network. The first ever run has no
// cache and shows nothing; the refresh populates it for next time (the standard
// notifier tradeoff). Set ARCADE_UPDATE_TEST=<version> to force a fake latest for
// testing all placements live, bypassing the cache, network, and dev/CI gates.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export type InstallKind = 'npx' | 'npm' | 'pnpm' | 'yarn';

export interface UpdateInfo {
  current: string;
  latest: string;
  kind: InstallKind;
  command: string; // the upgrade command to display for `kind`
}

interface Cache {
  latest?: string;
  checkedAt?: number;
}

// Re-fetch the registry at most this often; a launch inside the window reuses the
// cached latest rather than issuing another request.
const REFRESH_INTERVAL_MS = 1000 * 60 * 60 * 6; // 6 hours
const FETCH_TIMEOUT_MS = 1500;

// The running package's identity, from the bundled package.json. The update check needs the
// name and version; `--version` / `--help` print the description too.
export function packageInfo(): { name: string; version: string; description: string } {
  const p = fileURLToPath(new URL('../../package.json', import.meta.url));
  const raw = JSON.parse(readFileSync(p, 'utf8')) as { name?: string; version?: string; description?: string };
  return { name: raw.name ?? '@vercel/arcade', version: raw.version ?? '0.0.0', description: raw.description ?? '' };
}

function cachePath(): string {
  const base = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config');
  return join(base, 'arcade', 'update.json');
}

function readCache(): Cache {
  try {
    return JSON.parse(readFileSync(cachePath(), 'utf8')) as Cache;
  } catch {
    return {};
  }
}

function writeCache(c: Cache): void {
  try {
    const file = cachePath();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(c), { mode: 0o600 });
  } catch {
    // a notifier cache is best-effort; never let it break launch
  }
}

function isCI(): boolean {
  return Boolean(process.env.CI) && process.env.CI !== '0' && process.env.CI !== 'false';
}

// Non-notifying environments: a local checkout (pnpm dev/watch/snapshot) and CI. The
// ARCADE_UPDATE_TEST override deliberately bypasses this so the flow can be exercised
// from a dev checkout.
function suppressed(): boolean {
  return process.env.ARCADE_DEV === '1' || isCI();
}

// Compare two semver-ish versions, returning true if `latest` is strictly newer than
// `current`. Handles the plain `x.y.z` the arcade uses, plus a trailing prerelease
// (`x.y.z-beta.1`), which sorts before its release. Build metadata is ignored.
export function isNewer(current: string, latest: string): boolean {
  const parse = (v: string): { core: number[]; pre: string | null } => {
    const [main = ''] = v.trim().replace(/^v/, '').split('+');
    const [core, pre = null] = main.split('-');
    return { core: core.split('.').map((n) => Number.parseInt(n, 10) || 0), pre };
  };
  const a = parse(current);
  const b = parse(latest);
  for (let i = 0; i < 3; i++) {
    const av = a.core[i] ?? 0;
    const bv = b.core[i] ?? 0;
    if (bv !== av) return bv > av;
  }
  // Same core: a prerelease is older than its release; two prereleases compare lexically.
  if (a.pre && !b.pre) return true;
  if (!a.pre && b.pre) return false;
  if (a.pre && b.pre) return b.pre > a.pre;
  return false;
}

// Best-effort guess of how the arcade was installed, used only to display the matching
// upgrade command (never to run it). The npx cache dir is an unambiguous marker;
// otherwise fall back to package-manager hints in the path / env, defaulting to npm.
export function detectInstall(
  name: string,
  entryPath: string = fileURLToPath(import.meta.url),
  env: NodeJS.ProcessEnv = process.env,
): { kind: InstallKind; command: string } {
  const spec = `${name}@latest`;
  const has = (frag: string): boolean => entryPath.includes(`${sep}${frag}${sep}`);

  let kind: InstallKind = 'npm';
  if (has('_npx')) kind = 'npx';
  else if (has('.pnpm') || has('pnpm') || (env.PNPM_HOME && entryPath.startsWith(env.PNPM_HOME))) kind = 'pnpm';
  else if (has('.yarn') || has('yarn')) kind = 'yarn';

  const command =
    kind === 'npx'
      ? `npx ${spec}`
      : kind === 'pnpm'
        ? `pnpm add -g ${spec}`
        : kind === 'yarn'
          ? `yarn global add ${spec}`
          : `npm i -g ${spec}`;
  return { kind, command };
}

// Synchronous launch check: returns update info when a newer version is known, else
// null. Reads only the cache (and the ARCADE_UPDATE_TEST override) — no network.
export function checkForUpdate(): UpdateInfo | null {
  const { name, version: current } = packageInfo();

  const forced = process.env.ARCADE_UPDATE_TEST?.trim();
  let latest: string | undefined;
  if (forced) {
    latest = forced;
  } else {
    if (suppressed()) return null;
    latest = readCache().latest;
  }

  if (!latest || !isNewer(current, latest)) return null;
  const { kind, command } = detectInstall(name);
  return { current, latest, kind, command };
}

// Fire-and-forget registry lookup that refreshes the cache for the NEXT launch. Never
// throws and never blocks: it runs unawaited during the session. Skipped in dev/CI,
// under the test override, and while the cache is still fresh.
export function refreshLatestInBackground(): void {
  if (process.env.ARCADE_UPDATE_TEST || suppressed()) return;
  const cache = readCache();
  if (cache.checkedAt && Date.now() - cache.checkedAt < REFRESH_INTERVAL_MS) return;

  const { name } = packageInfo();
  void fetchLatest(name)
    .then((latest) => {
      if (latest) writeCache({ latest, checkedAt: Date.now() });
    })
    .catch(() => {});
}

// Read the `latest` dist-tag from the npm registry. Scoped names are URL-encoded.
async function fetchLatest(name: string): Promise<string | undefined> {
  const url = `https://registry.npmjs.org/-/package/${encodeURIComponent(name)}/dist-tags`;
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) return undefined;
  const tags = (await res.json()) as Record<string, string>;
  return typeof tags.latest === 'string' ? tags.latest : undefined;
}
