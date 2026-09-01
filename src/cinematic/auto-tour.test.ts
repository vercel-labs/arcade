import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LIVING_TITLE_TOUR_SECONDS, advanceAutoTourProgress, interruptsAutoTourKey } from './auto-tour.ts';

test('auto tour advances normalized scroll time at a constant rate', () => {
  assert.equal(advanceAutoTourProgress(0, LIVING_TITLE_TOUR_SECONDS / 2), 0.5);
  assert.equal(advanceAutoTourProgress(0.25, LIVING_TITLE_TOUR_SECONDS / 4), 0.5);
  assert.equal(advanceAutoTourProgress(0.98, 10), 1);
});

test('only navigation keys interrupt the tour', () => {
  for (const key of ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' ']) assert.equal(interruptsAutoTourKey(key), true);
  for (const key of ['Tab', 'Enter', 'a', 'Escape']) assert.equal(interruptsAutoTourKey(key), false);
});
