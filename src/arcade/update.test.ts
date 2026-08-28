// The update notifier's pure logic: semver-ish comparison, install-method detection
// (path/env → upgrade command), and the launch check's env gating. No network — the
// registry fetch and cache file are exercised only through the ARCADE_UPDATE_TEST hook.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sep } from 'node:path';
import { isNewer, detectInstall, checkForUpdate, packageInfo } from './update.ts';

test('isNewer compares core versions', () => {
  assert.equal(isNewer('0.1.2', '0.1.3'), true, 'patch bump');
  assert.equal(isNewer('0.1.2', '0.2.0'), true, 'minor bump');
  assert.equal(isNewer('0.1.2', '1.0.0'), true, 'major bump');
  assert.equal(isNewer('0.1.2', '0.1.2'), false, 'equal is not newer');
  assert.equal(isNewer('0.2.0', '0.1.9'), false, 'older is not newer');
  assert.equal(isNewer('1.0.0', '0.9.9'), false, 'lower major is not newer');
});

test('isNewer tolerates v-prefix and build metadata', () => {
  assert.equal(isNewer('v0.1.2', 'v0.1.3'), true);
  assert.equal(isNewer('0.1.2+build.1', '0.1.3+build.9'), true);
});

test('isNewer orders prereleases before their release', () => {
  assert.equal(isNewer('0.2.0-beta.1', '0.2.0'), true, 'release is newer than its prerelease');
  assert.equal(isNewer('0.2.0', '0.2.0-beta.1'), false, 'prerelease is not newer than the release');
  assert.equal(isNewer('0.2.0-beta.1', '0.2.0-beta.2'), true, 'later prerelease is newer');
});

const NAME = '@vercel/arcade';
const p = (...segs: string[]): string => sep + segs.join(sep) + sep;

test('detectInstall recognizes an npx run', () => {
  const { kind, command } = detectInstall(NAME, p('home', '.npm', '_npx', 'abc', 'node_modules', '@vercel', 'arcade', 'src'), {});
  assert.equal(kind, 'npx');
  assert.equal(command, 'npx @vercel/arcade@latest');
});

test('detectInstall recognizes a pnpm global install (path and PNPM_HOME)', () => {
  const byPath = detectInstall(NAME, p('home', '.local', 'share', 'pnpm', 'global', '5', 'node_modules', '@vercel', 'arcade'), {});
  assert.equal(byPath.kind, 'pnpm');
  assert.equal(byPath.command, 'pnpm add -g @vercel/arcade@latest');

  const home = `${sep}home${sep}me${sep}Library${sep}pnpm`;
  const byEnv = detectInstall(NAME, `${home}${sep}store${sep}arcade${sep}index.js`, { PNPM_HOME: home });
  assert.equal(byEnv.kind, 'pnpm');
});

test('detectInstall recognizes a yarn global install', () => {
  const { kind, command } = detectInstall(NAME, p('home', '.yarn', 'global', 'node_modules', '@vercel', 'arcade'), {});
  assert.equal(kind, 'yarn');
  assert.equal(command, 'yarn global add @vercel/arcade@latest');
});

test('detectInstall defaults to npm global', () => {
  const { kind, command } = detectInstall(NAME, p('usr', 'local', 'lib', 'node_modules', '@vercel', 'arcade', 'src'), {});
  assert.equal(kind, 'npm');
  assert.equal(command, 'npm i -g @vercel/arcade@latest');
});

// Snapshot + restore the env keys the check reads, so tests don't leak into each other.
function withEnv(overrides: Record<string, string | undefined>, fn: () => void): void {
  const keys = ['ARCADE_UPDATE_TEST', 'ARCADE_DEV', 'CI'];
  const saved = new Map(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  for (const [k, v] of Object.entries(overrides)) if (v !== undefined) process.env[k] = v;
  try {
    fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('checkForUpdate: ARCADE_UPDATE_TEST forces a newer version through', () => {
  withEnv({ ARCADE_UPDATE_TEST: '99.0.0' }, () => {
    const info = checkForUpdate();
    assert.ok(info, 'an update is reported');
    assert.equal(info?.latest, '99.0.0');
    assert.match(info?.command ?? '', /@vercel\/arcade@latest$/);
  });
});

test('checkForUpdate: no notice when the forced version is not newer', () => {
  withEnv({ ARCADE_UPDATE_TEST: '0.0.1' }, () => {
    assert.equal(checkForUpdate(), null);
  });
});

test('checkForUpdate: suppressed in a dev checkout (no override)', () => {
  withEnv({ ARCADE_DEV: '1' }, () => {
    assert.equal(checkForUpdate(), null, 'dev checkout never notifies without the test override');
  });
});

// The identity behind `--version` / `--help`: real values from package.json, not the
// hard-coded fallbacks (which would signal the file couldn't be read).
test('packageInfo reads name, version, and description from package.json', () => {
  const { name, version, description } = packageInfo();
  assert.equal(name, '@vercel/arcade');
  assert.match(version, /^\d+\.\d+\.\d+/, 'a semver-ish version');
  assert.ok(description.length > 0, 'a non-empty description');
});
