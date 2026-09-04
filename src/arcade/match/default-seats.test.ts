import assert from 'node:assert/strict';
import test from 'node:test';
import { CHESS_CREATOR_RANKING, DEFAULT_CREATOR_RANKING, DEFAULT_TOOL_MODELS, dealDefaultCreators, defaultToolModels, rankedCreators } from './default-seats.ts';
import type { ModelCreator } from './model-seat-picker.ts';

const creator = (slug: string, ...ids: string[]): ModelCreator => ({ slug, name: slug, models: ids.map((id) => ({ id, name: id })) });
const full = [creator('openai', 'openai/a'), creator('anthropic', 'anthropic/a'), creator('google', 'google/a'), creator('spacexai', 'spacexai/a'), creator('zai', 'zai/a')];

test('the ranking opens with the four flagship labs and covers every benchmarked creator once', () => {
  assert.deepEqual(DEFAULT_CREATOR_RANKING.slice(0, 4), ['openai', 'anthropic', 'google', 'spacexai']);
  assert.equal(new Set(DEFAULT_CREATOR_RANKING).size, DEFAULT_CREATOR_RANKING.length);
  assert.equal(DEFAULT_CREATOR_RANKING.at(-1), 'meta');
  assert.deepEqual(CHESS_CREATOR_RANKING.slice(0, 3), ['anthropic', 'openai', 'google']);
});

test('a spectated table deals down the ranking and wraps once every present creator is seated', () => {
  assert.deepEqual(dealDefaultCreators(full, 6), ['openai', 'anthropic', 'google', 'spacexai', 'zai', 'openai']);
});

test('the human seat swallows no rank: the first AI seat still gets OpenAI', () => {
  assert.deepEqual(dealDefaultCreators(full, 4, [1, 2, 3]), [null, 'openai', 'anthropic', 'google']);
  assert.deepEqual(dealDefaultCreators(full, 2, [0]), ['openai', null]);
});

test('a creator missing from the team catalog is skipped and the rest shift up', () => {
  const noAnthropic = full.filter((c) => c.slug !== 'anthropic');
  assert.deepEqual(dealDefaultCreators(noAnthropic, 4, [1, 2, 3]), [null, 'openai', 'google', 'spacexai']);
  const onlyGoogle = [creator('google', 'google/a'), creator('zai', 'zai/a')];
  assert.deepEqual(dealDefaultCreators(onlyGoogle, 3), ['google', 'zai', 'google']);
});

test('creators the ranking never saw come last, alphabetically', () => {
  const odd = [creator('mistral', 'mistral/a'), creator('cohere', 'cohere/a'), creator('google', 'google/a')];
  assert.deepEqual(rankedCreators(odd), ['google', 'cohere', 'mistral']);
});

test('a creator with no models does not count as present; an unrelated catalog leaves seats unset', () => {
  assert.deepEqual(dealDefaultCreators([creator('openai')], 2), [null, null]);
  assert.deepEqual(dealDefaultCreators([], 1), [null]);
});

test('chess fixes Anthropic to White and OpenAI to Black whichever side the human takes', () => {
  assert.deepEqual(dealDefaultCreators(full, 2, undefined, CHESS_CREATOR_RANKING), ['anthropic', 'openai']);
  assert.deepEqual(dealDefaultCreators(full.filter((c) => c.slug !== 'anthropic'), 2, undefined, CHESS_CREATOR_RANKING), ['openai', 'google']);
});

test('tools get one fast model per flagship creator', () => {
  assert.deepEqual(defaultToolModels(5), [...DEFAULT_TOOL_MODELS, DEFAULT_TOOL_MODELS[0]]);
  assert.deepEqual(DEFAULT_TOOL_MODELS.map((id) => id.split('/')[0]), DEFAULT_CREATOR_RANKING.slice(0, 4));
});
