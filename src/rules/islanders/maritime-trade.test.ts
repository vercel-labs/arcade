import assert from 'node:assert/strict';
import test from 'node:test';
import { maritimePortTradeRates, maritimeTradeRate, maritimeTradeRates, portsAtNodes } from './maritime-trade.ts';
import { RESOURCES, type Port } from './types.ts';

const generic: Port = { ratio: 3, resource: null };
const brick: Port = { ratio: 2, resource: 'brick' };

test('maritime rates use the best applicable port for each offered resource', () => {
  for (const resource of RESOURCES) assert.equal(maritimeTradeRate([], resource), 4);
  for (const resource of RESOURCES) assert.equal(maritimeTradeRate([generic], resource), 3);
  assert.equal(maritimeTradeRate([brick], 'brick'), 2);
  assert.equal(maritimeTradeRate([brick], 'grain'), 4);
  assert.deepEqual(maritimeTradeRates([generic, brick]), {
    brick: 2,
    grain: 3,
    lumber: 3,
    ore: 3,
    wool: 3,
  });
  assert.deepEqual(maritimePortTradeRates([generic, brick]), {
    brick: [2, 3],
    grain: [3],
    lumber: [3],
    ore: [3],
    wool: [3],
  });
});

test('either endpoint of a harbor grants that port once', () => {
  const harbors = [
    { port: generic, nodes: [4, 5] },
    { port: brick, nodes: [8, 9] },
  ];
  assert.deepEqual(portsAtNodes(harbors, [4]), [generic]);
  assert.deepEqual(portsAtNodes(harbors, [5]), [generic]);
  assert.deepEqual(portsAtNodes(harbors, [8]), [brick]);
  assert.deepEqual(portsAtNodes(harbors, [9]), [brick]);
  assert.deepEqual(portsAtNodes(harbors, [4, 5]), [generic]);
});
