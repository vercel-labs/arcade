import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitPlayerName } from './poker-hud.ts';

test('player names fit beside the stack and pinned badge', () => {
  assert.equal(fitPlayerName('gpt-5.4-nano', 940, 'BTN'), 'gpt-5.4-nano');
  assert.equal(fitPlayerName('grok-4.1-fast-non-reasoning', 988, 'BTN'), 'grok-4.1-fast-non-re…');
  assert.equal(fitPlayerName('claude-haiku-4.5', 0, 'eliminated'), 'claude-haiku-4.5');
});
