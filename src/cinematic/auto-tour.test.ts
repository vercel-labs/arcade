import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LIVING_TITLE_TOUR_SECONDS, advanceAutoTourProgress, interruptsAutoTourKey } from './auto-tour.ts';

test('auto tour advances every chapter at one constant rate', () => {
  assert.equal(advanceAutoTourProgress(0, LIVING_TITLE_TOUR_SECONDS), 1);
  assert.equal(advanceAutoTourProgress(0.25, 9.5), 0.5);
  assert.equal(advanceAutoTourProgress(0.98, 10), 1);
});

test('constant speed maps the authored chapter shares to 3s, 5s, 9s, 11s, and 10s', () => {
  assert.deepEqual([3 / 38, 5 / 38, 9 / 38, 11 / 38, 10 / 38].map((share) => share * LIVING_TITLE_TOUR_SECONDS), [3, 5, 9, 11, 10]);
});

test('only navigation keys interrupt the tour', () => {
  for (const key of ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' ']) assert.equal(interruptsAutoTourKey(key), true);
  for (const key of ['Tab', 'Enter', 'a', 'Escape']) assert.equal(interruptsAutoTourKey(key), false);
});
