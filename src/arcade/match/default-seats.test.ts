import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SEAT_LADDER, defaultSeatModelIds, resolveDefaultSeats } from './default-seats.ts';
import type { ModelCreator } from './model-seat-picker.ts';

const creator = (slug: string, ...ids: string[]): ModelCreator => ({ slug, name: slug, models: ids.map((id) => ({ id, name: id })) });

test('a full catalog seats the ladder heads across four creators, then wraps to each creator\'s next model', () => {
  const catalog = [
    creator('openai', 'openai/gpt-5.6-luna', 'openai/gpt-5.6-sol', 'openai/gpt-5.4-nano'),
    creator('anthropic', 'anthropic/claude-sonnet-5', 'anthropic/claude-haiku-4.5'),
    creator('google', 'google/gemini-3.8-flash', 'google/gemini-2.5-flash'),
    creator('spacexai', 'spacexai/grok-4.20-non-reasoning', 'spacexai/grok-4.1-fast-non-reasoning'),
  ];
  assert.deepEqual(resolveDefaultSeats(catalog, 6).map((seat) => seat?.model), [
    'openai/gpt-5.6-luna',
    'anthropic/claude-sonnet-5',
    'google/gemini-3.8-flash',
    'spacexai/grok-4.20-non-reasoning',
    'openai/gpt-5.6-sol',
    'anthropic/claude-haiku-4.5',
  ]);
  assert.equal(resolveDefaultSeats(catalog, 6)[3]?.creator, 'spacexai');
});

test('a creator missing from the team catalog is skipped for the next creator, and its alias slug still resolves', () => {
  const noGoogleOldXai = [
    creator('openai', 'openai/gpt-5.4-nano'),
    creator('anthropic', 'anthropic/claude-haiku-4.5'),
    creator('xai', 'xai/grok-4.1-fast-non-reasoning'),
  ];
  assert.deepEqual(resolveDefaultSeats(noGoogleOldXai, 4), [
    { creator: 'openai', model: 'openai/gpt-5.4-nano' },
    { creator: 'anthropic', model: 'anthropic/claude-haiku-4.5' },
    // Google's rung is empty, so seat 3 continues to xAI under its old catalog slug.
    { creator: 'xai', model: 'xai/grok-4.1-fast-non-reasoning' },
    // Every ladder model is now used: the fourth seat stays unset rather than repeating one.
    null,
  ]);
});

test('an empty or unrelated catalog leaves every seat unset', () => {
  assert.deepEqual(resolveDefaultSeats([], 2), [null, null]);
  assert.deepEqual(resolveDefaultSeats([creator('mistral', 'mistral/mistral-large-3')], 2), [null, null]);
});

test('tools get the ladder heads without a catalog', () => {
  assert.deepEqual(defaultSeatModelIds(4), DEFAULT_SEAT_LADDER.map((rung) => rung.models[0]));
  assert.equal(defaultSeatModelIds(5)[4], DEFAULT_SEAT_LADDER[0].models[0]);
});
