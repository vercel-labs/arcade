import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMatchPlans, parseMatchLabConfig } from './config.ts';

test('parses models, bounds, and rotates seats deterministically', () => {
  const config = parseMatchLabConfig([
    '--game=chess', '--models=a,b', '--games=3', '--concurrency=2', '--seed=9', '--max-plies=20', '--swap-seats',
  ]);
  const plans = buildMatchPlans(config);
  assert.equal(config.concurrency, 2);
  assert.equal(config.limits.maxPlies, 20);
  assert.deepEqual(plans.map((plan) => plan.models), [['a', 'b'], ['b', 'a'], ['a', 'b']]);
  assert.equal(new Set(plans.map((plan) => plan.seed)).size, 3);
});

test('rejects a model count that cannot play the selected game', () => {
  assert.throws(() => parseMatchLabConfig(['--game=catan', '--models=a,b']), /3 or 4 models/);
});
