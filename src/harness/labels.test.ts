import assert from 'node:assert/strict';
import test from 'node:test';

import { disambiguateLabels } from './labels.ts';

test('every duplicate visible name receives a stable parenthesized index', () => {
  assert.deepEqual(
    disambiguateLabels([
      { key: 'anthropic/claude-haiku-4.5', label: 'claude-haiku-4.5' },
      { key: 'anthropic/claude-haiku-4.5', label: 'claude-haiku-4.5' },
      { key: 'other/claude-haiku-4.5', label: 'claude-haiku-4.5' },
      { key: 'openai/gpt-5.4', label: 'gpt-5.4' },
    ]),
    ['claude-haiku-4.5 (1)', 'claude-haiku-4.5 (2)', 'claude-haiku-4.5 (3)', 'gpt-5.4'],
  );
});

test('three or more duplicate seats count upward in seat order', () => {
  assert.deepEqual(
    disambiguateLabels([
      { key: 'xai/grok', label: 'grok' },
      { key: 'xai/grok', label: 'grok' },
      { key: 'xai/grok', label: 'grok' },
    ]),
    ['grok (1)', 'grok (2)', 'grok (3)'],
  );
});
