import assert from 'node:assert/strict';
import test from 'node:test';
import { islandersMatchLabLabels } from './islanders.ts';

test('Islanders Match Lab uses concise disambiguated prompt labels', () => {
  assert.deepEqual(
    islandersMatchLabLabels([
      'anthropic/claude-opus-5',
      'other/claude-opus-5',
      'openai/gpt-5.4',
      'xai/grok-4.1-fast-non-reasoning',
    ]),
    ['claude-opus-5 (1)', 'claude-opus-5 (2)', 'gpt-5.4', 'grok-4.1-fast-non-reasoning'],
  );
});
