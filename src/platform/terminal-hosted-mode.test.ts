import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const terminal = readFileSync(new URL('./terminal.ts', import.meta.url), 'utf8');

test('hosted mode markers share the exact raw-mode enter and leave boundaries', () => {
  assert.ok(terminal.includes("process.env.ARCADE_HOSTED_TERMINAL === '1'"));
  assert.ok(terminal.includes('hostedMode(true) + ALT_SCREEN_ON'));
  assert.ok(terminal.includes('ALT_SCREEN_OFF + hostedMode(false)'));
});
