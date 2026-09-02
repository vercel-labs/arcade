import assert from 'node:assert/strict';
import test from 'node:test';
import { orderCreatorModels } from './model-catalog-order.ts';

test('orders models by Gateway popularity and keeps a fast variant after its base', () => {
  const models = [
    { id: 'openai/alpha', name: 'Alpha' },
    { id: 'openai/base-fast', name: 'Base Fast' },
    { id: 'openai/base', name: 'Base' },
    { id: 'openai/orphan-fast', name: 'Orphan Fast' },
    { id: 'openai/zulu', name: 'Zulu' },
  ];
  assert.deepEqual(
    orderCreatorModels(models, ['openai/zulu', 'openai/base-fast', 'openai/orphan-fast', 'openai/base']),
    [models[4], models[3], models[2], models[1], models[0]],
  );
});

test('unranked models retain deterministic alphabetical fallback', () => {
  const models = [
    { id: 'provider/z', name: 'Zulu' },
    { id: 'provider/a', name: 'Alpha' },
  ];
  assert.deepEqual(orderCreatorModels(models, []), [models[1], models[0]]);
});
