import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bannerLines, shouldPrint } from './install-banner.ts';

const plain = (env: NodeJS.ProcessEnv = {}, platform = 'linux'): string[] =>
  bannerLines({ color: false, env: { PATH: '/usr/local/bin', ...env }, platform });

test('the banner tells the reader the command and where the docs are', () => {
  const text = plain().join('\n');
  assert.match(text, /The 3D game engine built for agents\./);
  assert.match(text, /^\s*arcade\s+launch Arcade$/m);
  assert.match(text, /arcade --help/);
  assert.match(text, /ascii-arcade\.dev\/docs/);
  assert.match(text, /^\s*first launch signs you in with Vercel\.\s*$/m);
  assert.match(text, /^\s*the tutorial is available from the menu\.\s*$/m);
  assert.match(text, /billed to the team you select/);
});

test('the install wordmark is a compact Press Start-style arcade bitmap', () => {
  const lines = plain();
  const mark = lines.slice(1, 5);
  assert.equal(mark.length, 4);
  assert.ok(mark.every((line) => line.length <= 53));
  assert.ok(mark.some((line) => line.includes('▄')), 'the 7px face should use half-block geometry');
  assert.ok(mark.some((line) => line.includes('░')), 'the wordmark should retain its shallow shadow without color');
});

test('color: false emits no escape sequences', () => {
  assert.ok(!plain().join('').includes('\x1b'));
});

test('the colored wordmark keeps its glyphs and closes every sequence', () => {
  const colored = bannerLines({
    color: true,
    colorDepth: 'truecolor',
    env: { PATH: '/usr/local/bin' },
    platform: 'linux',
  });
  const glyphs = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');
  assert.deepEqual(
    colored.map(glyphs).map((line) => line.replaceAll('█', '░')),
    plain().map((line) => line.replaceAll('█', '░')),
    'stripping color must preserve the same occupied wordmark cells',
  );
  assert.ok(!colored.slice(1, 5).join('').includes('░'), 'colored shadows are solid, not stippled');
  const opens = colored.join('').match(/\x1b\[[0-9;]+m/g)?.length ?? 0;
  const resets = colored.join('').match(/\x1b\[0m/g)?.length ?? 0;
  assert.ok(opens > resets && resets > 0, 'runs of color are closed, not left open');
});

test('a 256-color wordmark stays compact and skips fg+bg blend codes', () => {
  const lines = bannerLines({
    color: true,
    colorDepth: '256',
    env: { PATH: '/usr/local/bin' },
    platform: 'linux',
  });
  const mark = lines.slice(1, 5);
  assert.equal(mark.length, 4, 'stays the same compact height as the truecolor version');
  const text = mark.join('');
  assert.doesNotMatch(text, /48;5/, 'no background-color codes — nothing for a shaky 256-color renderer to blend');
  assert.match(text, /38;5;255/, 'the face still renders');
  assert.match(text, /38;5;237/, 'the shadow still renders');
});

test('a 256-color terminal gets a heads-up, a truecolor one does not', () => {
  const withoutTruecolor = bannerLines({
    color: true,
    env: { PATH: '/usr/local/bin' },
    platform: 'linux',
  }).join('\n');
  assert.match(withoutTruecolor, /doesn't support truecolor/);
  assert.match(withoutTruecolor, /some appearances may be off/);
  assert.match(withoutTruecolor, /Ghostty/);
  assert.match(withoutTruecolor, /VS Code\/Cursor/);

  const withTruecolor = bannerLines({
    color: true,
    colorDepth: 'truecolor',
    env: { PATH: '/usr/local/bin' },
    platform: 'linux',
  }).join('\n');
  assert.doesNotMatch(withTruecolor, /doesn't support truecolor/);

  assert.doesNotMatch(plain().join('\n'), /doesn't support truecolor/, 'no notice without color at all');
});

test('the PATH hint appears only when the global bin dir is missing from PATH', () => {
  const hint = /not in your PATH/;
  // Prefix known and present.
  assert.doesNotMatch(
    plain({ npm_config_prefix: '/usr/local', PATH: '/bin:/usr/local/bin' }).join('\n'),
    hint,
  );
  // Prefix known and absent.
  assert.match(plain({ npm_config_prefix: '/opt/node', PATH: '/bin' }).join('\n'), hint);
  // pnpm reports its own bin dir…
  assert.match(plain({ PNPM_HOME: '/home/x/.pnpm', PATH: '/bin' }).join('\n'), hint);
  // …but a PNPM_HOME left in the shell must not mask the prefix npm is installing into.
  assert.match(
    plain({ npm_config_prefix: '/opt/node', PNPM_HOME: '/bin', PATH: '/bin' }).join('\n'),
    /\/opt\/node\/bin is not in your PATH/,
  );
  // Nothing to compare against: stay quiet rather than guess.
  assert.doesNotMatch(plain({ PATH: '/bin' }).join('\n'), hint);
  // Windows puts bins in the prefix itself, compared case-insensitively, and may
  // spell the variable `Path`.
  assert.doesNotMatch(
    bannerLines({
      color: false,
      env: { npm_config_prefix: 'C:\\Node', Path: 'C:\\NODE' },
      platform: 'win32',
    }).join('\n'),
    hint,
  );
});

test('only a global install prints', () => {
  assert.ok(shouldPrint({ npm_config_global: 'true' }));
  assert.ok(!shouldPrint({}), 'a dev checkout or local install stays silent');
  assert.ok(!shouldPrint({ npm_config_global: 'false' }));
});

test('quiet installs stay quiet', () => {
  const global = { npm_config_global: 'true' };
  assert.ok(!shouldPrint({ ...global, CI: 'true' }));
  assert.ok(!shouldPrint({ ...global, ARCADE_NO_BANNER: '1' }));
  assert.ok(!shouldPrint({ ...global, npm_config_silent: 'true' }));
  assert.ok(!shouldPrint({ ...global, npm_config_loglevel: 'silent' }));
  assert.ok(!shouldPrint({ ...global, npm_config_loglevel: 'warn' }));
  assert.ok(shouldPrint({ ...global, CI: 'false' }), 'CI=false is not CI');
  assert.ok(shouldPrint({ ...global, npm_config_loglevel: 'notice' }));
});
