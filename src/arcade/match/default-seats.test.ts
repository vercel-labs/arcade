import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_CREATOR_CYCLE, DEFAULT_TOOL_MODELS, defaultToolModels, resolveDefaultCreators } from './default-seats.ts';
import type { ModelCreator } from './model-seat-picker.ts';

const creator = (slug: string, ...ids: string[]): ModelCreator => ({ slug, name: slug, models: ids.map((id) => ({ id, name: id })) });
const full = [creator('openai', 'openai/a'), creator('anthropic', 'anthropic/a'), creator('google', 'google/a'), creator('spacexai', 'spacexai/a'), creator('zai', 'zai/a')];

test('a full catalog cycles OpenAI, Anthropic, Google, xAI, then gives OpenAI and Anthropic a second seat', () => {
  assert.deepEqual(resolveDefaultCreators(full, 6), ['openai', 'anthropic', 'google', 'spacexai', 'openai', 'anthropic']);
  assert.deepEqual(DEFAULT_CREATOR_CYCLE, ['openai', 'anthropic', 'google', 'spacexai']);
});

test('a creator missing from the team catalog is skipped, and repeats start only once every present creator is seated', () => {
  const noXai = full.filter((c) => c.slug !== 'spacexai');
  assert.deepEqual(resolveDefaultCreators(noXai, 6), ['openai', 'anthropic', 'google', 'openai', 'anthropic', 'google']);
  const onlyGoogle = [creator('google', 'google/a'), creator('zai', 'zai/a')];
  assert.deepEqual(resolveDefaultCreators(onlyGoogle, 3), ['google', 'google', 'google']);
});

test('a creator with no models does not count as present; an unrelated catalog leaves seats unset', () => {
  assert.deepEqual(resolveDefaultCreators([creator('openai'), creator('zai', 'zai/a')], 2), [null, null]);
  assert.deepEqual(resolveDefaultCreators([], 1), [null]);
});

test('tools get one fast model per creator in the cycle', () => {
  assert.deepEqual(defaultToolModels(5), [...DEFAULT_TOOL_MODELS, DEFAULT_TOOL_MODELS[0]]);
  assert.deepEqual(DEFAULT_TOOL_MODELS.map((id) => id.split('/')[0]), DEFAULT_CREATOR_CYCLE);
});
