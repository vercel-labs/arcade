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

test('Catan match lab accepts two through four models and rejects other table sizes', () => {
  assert.equal(parseMatchLabConfig(['--game=catan', '--models=a,b']).models.length, 2);
  assert.equal(parseMatchLabConfig(['--game=catan', '--models=a,b,c']).models.length, 3);
  assert.equal(parseMatchLabConfig(['--game=catan', '--models=a,b,c,d']).models.length, 4);
  assert.throws(() => parseMatchLabConfig(['--game=catan', '--models=a']), /2 through 4 models/);
  assert.throws(() => parseMatchLabConfig(['--game=catan', '--models=a,b,c,d,e']), /2 through 4 models/);
});

test('uses live Poker tournament defaults and accepts explicit overrides', () => {
  const defaults = parseMatchLabConfig(['--game=poker']);
  assert.deepEqual(
    [defaults.startingChips, defaults.smallBlind, defaults.bigBlind, defaults.handsPerLevel],
    [1_000, 10, 20, 15],
  );
  const config = parseMatchLabConfig(['--game=poker', '--starting-chips=2500', '--small-blind=5', '--big-blind=10', '--hands-per-level=8']);
  assert.equal(config.startingChips, 2_500);
  const plan = buildMatchPlans(config)[0];
  assert.deepEqual([plan.startingChips, plan.smallBlind, plan.bigBlind, plan.handsPerLevel], [2_500, 5, 10, 8]);
});
