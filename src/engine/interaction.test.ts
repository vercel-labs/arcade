import assert from 'node:assert/strict';
import test from 'node:test';
import { hysteresisThreshold, nearestHit, resolveStickyHover } from './interaction.ts';

test('nearestHit compares semantic priority before normalized score', () => {
  const hit = nearestHit([
    { id: 'road', distance: 0.01, radius: 1, score: 0.01, priority: 1 },
    { id: 'node', distance: 0.4, radius: 1, score: 0.4, priority: 0 },
  ], { priority: (candidate) => candidate.priority });
  assert.equal(hit?.id, 'node');
});

test('nearestHit filters candidates outside its score threshold', () => {
  assert.equal(nearestHit([{ distance: 2, radius: 1, score: 2 }]), null);
});

test('resolveStickyHover retains, switches, and releases predictably', () => {
  const current = { id: 'current', distance: 0.8, radius: 1, score: 0.8 };
  const close = { id: 'close', distance: 0.7, radius: 1, score: 0.7 };
  const clear = { id: 'clear', distance: 0.3, radius: 1, score: 0.3 };
  assert.equal(resolveStickyHover(current, close, { leaveScore: 1.5, switchBias: 0.2 })?.id, 'current');
  assert.equal(resolveStickyHover(current, clear, { leaveScore: 1.5, switchBias: 0.2 })?.id, 'clear');
  assert.equal(resolveStickyHover({ ...current, score: 2 }, null, { leaveScore: 1.5 })?.id, undefined);
});

test('hysteresisThreshold uses independent show and hide thresholds', () => {
  assert.equal(hysteresisThreshold(9, null, 10, 8), false);
  assert.equal(hysteresisThreshold(10, false, 10, 8), true);
  assert.equal(hysteresisThreshold(9, true, 10, 8), true);
  assert.equal(hysteresisThreshold(7, true, 10, 8), false);
});
