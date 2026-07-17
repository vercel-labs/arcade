import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  detectTerminalColorMode,
  environmentAdvertisesTruecolor,
  parseTruecolorProbeResponse,
} from './terminal-color-detection.ts';

describe('terminal truecolor environment detection', () => {
  test('recognizes standard truecolor advertisements', () => {
    assert.equal(environmentAdvertisesTruecolor({ COLORTERM: 'truecolor' }), true);
    assert.equal(environmentAdvertisesTruecolor({ COLORTERM: '24BIT' }), true);
    assert.equal(environmentAdvertisesTruecolor({ TERM: 'xterm-kitty' }), true);
    assert.equal(environmentAdvertisesTruecolor({ TERM: 'foot-direct' }), true);
    assert.equal(environmentAdvertisesTruecolor({ TERM_PROGRAM: 'vscode' }), true);
    assert.equal(environmentAdvertisesTruecolor({ WT_SESSION: 'session-id' }), true);
  });

  test('does not mistake a 256-color terminfo name for truecolor', () => {
    assert.equal(environmentAdvertisesTruecolor({ TERM: 'xterm-256color' }), false);
    assert.equal(environmentAdvertisesTruecolor({ TERM: 'screen-256color' }), false);
  });
});

describe('terminal truecolor active probe parsing', () => {
  test('accepts semicolon and normalized colon RGB responses', () => {
    assert.equal(parseTruecolorProbeResponse('\x1bP1$r48;2;1;2;3m\x1b\\'), true);
    assert.equal(parseTruecolorProbeResponse('\x1bP1$r48:2:1:2:3m\x1b\\'), true);
    assert.equal(parseTruecolorProbeResponse('\x1bP1$r48:2::1:2:3m\x1b\\'), true);
  });

  test('rejects downgraded and unsupported responses', () => {
    assert.equal(parseTruecolorProbeResponse('\x1bP1$r40m\x1b\\'), false);
    assert.equal(parseTruecolorProbeResponse('\x1bP0$r\x1b\\'), false);
  });

  test('waits for a complete response', () => {
    assert.equal(parseTruecolorProbeResponse(''), null);
    assert.equal(parseTruecolorProbeResponse('\x1bP1$r48:2:1:2:3m'), null);
  });
});

describe('terminal color mode selection', () => {
  test('uses advertised truecolor without querying', async () => {
    let queried = false;
    const mode = await detectTerminalColorMode({
      env: { COLORTERM: 'truecolor' },
      stdinIsTTY: true,
      stdoutIsTTY: true,
      probe: async () => {
        queried = true;
        return false;
      },
    });
    assert.equal(mode, 'truecolor');
    assert.equal(queried, false);
  });

  test('actively probes an unknown terminal', async () => {
    assert.equal(
      await detectTerminalColorMode({
        env: { TERM: 'xterm-256color' },
        stdinIsTTY: true,
        stdoutIsTTY: true,
        probe: async () => true,
      }),
      'truecolor',
    );
  });

  test('requires active confirmation behind a multiplexer', async () => {
    assert.equal(
      await detectTerminalColorMode({
        env: { COLORTERM: 'truecolor', TMUX: '/tmp/tmux' },
        stdinIsTTY: true,
        stdoutIsTTY: true,
        probe: async () => false,
      }),
      '256-color',
    );
  });

  test('falls back safely outside a TTY or after an inconclusive probe', async () => {
    assert.equal(
      await detectTerminalColorMode({
        env: {},
        stdinIsTTY: false,
        stdoutIsTTY: true,
        probe: async () => true,
      }),
      '256-color',
    );
    assert.equal(
      await detectTerminalColorMode({
        env: {},
        stdinIsTTY: true,
        stdoutIsTTY: true,
        probe: async () => false,
      }),
      '256-color',
    );
  });
});
