import assert from 'node:assert/strict';
import test from 'node:test';
import { hash2, mulberry32, sineHash2 } from './random.ts';

test('mulberry32 is deterministic and seed-sensitive', () => {
  const first = mulberry32(1234);
  const second = mulberry32(1234);
  const other = mulberry32(1235);
  const values = Array.from({ length: 8 }, () => first());
  assert.deepEqual(values, Array.from({ length: 8 }, () => second()));
  assert.notDeepEqual(values, Array.from({ length: 8 }, () => other()));
  assert.ok(values.every((value) => value >= 0 && value < 1));
});

test('shared hashes are stable and normalized', () => {
  assert.equal(hash2(4, -7), hash2(4, -7));
  assert.equal(sineHash2(1.25, -2.5), sineHash2(1.25, -2.5));
  assert.ok(hash2(4, -7) >= 0 && hash2(4, -7) <= 1);
  assert.ok(sineHash2(1.25, -2.5) >= 0 && sineHash2(1.25, -2.5) < 1);
});
