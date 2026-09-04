import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createModelSeatPicker,
  selectModelSeat,
  setModelSeatCreators,
  type ModelCreator,
} from './model-seat-picker.ts';

const creators: ModelCreator[] = [
  {
    slug: 'alpha',
    name: 'Alpha',
    models: [
      { id: 'alpha/one', name: 'One' },
      { id: 'alpha/two', name: 'Two' },
    ],
  },
  {
    slug: 'beta',
    name: 'Beta',
    models: [{ id: 'beta/three', name: 'Three' }],
  },
];

test('model seat picker keeps creator, model, and dropdown state in sync', () => {
  let changes = 0;
  const picker = createModelSeatPicker({
    idPrefix: 'test-seat',
    creators,
    defaultCreator: 'alpha',
    defaultModelId: 'alpha/two',
    onChange: () => changes++,
  });

  assert.equal(picker.creator, 'alpha');
  assert.equal(picker.modelId, 'alpha/two');
  assert.equal(picker.creatorDropdown.value, 'Alpha');
  assert.equal(picker.modelDropdown.value, 'Two');

  selectModelSeat(picker, 'beta', 'beta/three');
  assert.equal(picker.creator, 'beta');
  assert.equal(picker.modelId, 'beta/three');
  assert.equal(picker.creatorDropdown.value, 'Beta');
  assert.equal(picker.modelDropdown.value, 'Three');
  assert.equal(changes, 3);
});

test('model seat picker can replace its catalog before restoring a selection', () => {
  const picker = createModelSeatPicker({
    idPrefix: 'replace-seat',
    creators: creators.slice(0, 1),
    defaultCreator: 'alpha',
  });

  setModelSeatCreators(picker, creators.slice(1));
  selectModelSeat(picker, 'beta', 'beta/three');

  assert.equal(picker.creator, 'beta');
  assert.equal(picker.modelId, 'beta/three');
  assert.deepEqual(picker.models.map((model) => model.id), ['beta/three']);
});

test('model seat picker preserves an available selection across catalog refreshes', () => {
  const picker = createModelSeatPicker({
    idPrefix: 'preserve-seat',
    creators,
    defaultCreator: 'alpha',
    defaultModelId: 'alpha/two',
  });

  setModelSeatCreators(picker, [creators[1], creators[0]]);

  assert.equal(picker.creator, 'alpha');
  assert.equal(picker.modelId, 'alpha/two');
  assert.equal(picker.creatorDropdown.value, 'Alpha');
  assert.equal(picker.modelDropdown.value, 'Two');
});

test('model seat picker chooses a valid replacement when a model becomes unavailable', () => {
  const picker = createModelSeatPicker({
    idPrefix: 'fallback-seat',
    creators,
    defaultCreator: 'alpha',
    defaultModelId: 'alpha/two',
  });

  setModelSeatCreators(picker, creators.slice(1));

  assert.equal(picker.creator, 'beta');
  assert.equal(picker.modelId, 'beta/three');
  assert.equal(picker.creatorDropdown.value, 'Beta');
  assert.equal(picker.modelDropdown.value, 'Three');
});

const creator = (slug: string, ...ids: string[]): ModelCreator => ({ slug, name: slug, models: ids.map((id) => ({ id, name: id })) });

test('a vanished model falls to the given default, or stays unset when told to', () => {
  const picker = createModelSeatPicker({ idPrefix: 'seat', creators: [creator('openai', 'openai/old')], defaultCreator: 'openai', defaultModelId: 'openai/old', onChange: () => {} });
  const fresh = [creator('openai', 'openai/new'), creator('google', 'google/gemini')];
  setModelSeatCreators(picker, fresh, { creator: 'google', model: 'google/gemini' });
  assert.equal(picker.modelId, 'google/gemini');
  assert.equal(picker.creator, 'google');
  setModelSeatCreators(picker, [creator('openai', 'openai/new')], null);
  assert.equal(picker.modelId, null, 'no silent substitution');
  assert.equal(picker.creator, 'openai', 'the creator column still has a value to browse from');
  assert.equal(picker.modelDropdown.value, null);
});
