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

test('model seat picker never substitutes a model when the chosen one becomes unavailable', () => {
  const picker = createModelSeatPicker({
    idPrefix: 'fallback-seat',
    creators,
    defaultCreator: 'alpha',
    defaultModelId: 'alpha/two',
  });

  setModelSeatCreators(picker, creators.slice(1));

  assert.equal(picker.creator, 'beta', 'the creator column still has a value to browse from');
  assert.equal(picker.modelId, null, 'the model waits for a real pick');
  assert.equal(picker.creatorDropdown.value, 'Beta');
  assert.equal(picker.modelDropdown.value, null);
});

const creator = (slug: string, ...ids: string[]): ModelCreator => ({ slug, name: slug, models: ids.map((id) => ({ id, name: id })) });

test('a catalog swap keeps the model, else the creator with the model unset, else the fallback creator', () => {
  const picker = createModelSeatPicker({ idPrefix: 'seat', creators: [creator('openai', 'openai/old')], defaultCreator: 'openai', defaultModelId: 'openai/old', onChange: () => {} });
  assert.equal(picker.modelId, 'openai/old');
  setModelSeatCreators(picker, [creator('openai', 'openai/new'), creator('google', 'google/gemini')], 'google');
  assert.equal(picker.creator, 'openai', 'the creator survives when the catalog still has it');
  assert.equal(picker.modelId, null, 'the vanished model is not replaced');
  assert.equal(picker.modelDropdown.value, null);
  setModelSeatCreators(picker, [creator('google', 'google/gemini')], 'google');
  assert.equal(picker.creator, 'google', 'a vanished creator falls to the default creator');
  assert.equal(picker.modelId, null);
  setModelSeatCreators(picker, [creator('zai', 'zai/glm')], null);
  assert.equal(picker.creator, 'zai', 'with nothing else to go on, the first creator');
  assert.equal(picker.modelId, null);
});
