import assert from 'node:assert/strict';
import test from 'node:test';
import { CoverFlowWheelInput } from './coverflow-input.ts';

test('Cover Flow keeps precise nudges and gently accelerates sustained horizontal swipes', () => {
  const input = new CoverFlowWheelInput();

  assert.equal(input.step({ wheel: 1, wheelAxis: 'horizontal' }, 1_000), 1);
  assert.equal(input.step({ wheel: 1, wheelAxis: 'horizontal' }, 1_100), 1);
  assert.equal(input.step({ wheel: 1, wheelAxis: 'horizontal' }, 1_180), 2);
  assert.equal(input.step({ wheel: 1, wheelAxis: 'horizontal' }, 1_240), 2);
  assert.equal(input.step({ wheel: 1, wheelAxis: 'horizontal' }, 1_300), 2);
  assert.equal(input.step({ wheel: -1, wheelAxis: 'horizontal' }, 1_150), -1);
  assert.equal(input.step({ wheel: -1, wheelAxis: 'horizontal' }, 1_500), -1);
});

test('vertical flings keep the first one-cover nudge and thin sustained reports', () => {
  const input = new CoverFlowWheelInput();

  assert.equal(input.step({ wheel: 1, wheelAxis: 'vertical' }, 1_000), 1);
  assert.equal(input.step({ wheel: 1, wheelAxis: 'vertical' }, 1_030), 0);
  assert.equal(input.step({ wheel: 1, wheelAxis: 'vertical' }, 1_060), 1);
  assert.equal(input.step({ wheel: 1, wheelAxis: 'vertical' }, 1_090), 0);
  assert.equal(input.step({ wheel: -1, wheelAxis: 'vertical' }, 1_120), -1);
  assert.equal(input.step({ wheel: -1, wheelAxis: 'vertical' }, 1_500), -1);
});

test('an active Cover Flow gesture rejects perpendicular axis noise', () => {
  const input = new CoverFlowWheelInput();

  assert.equal(input.step({ wheel: 1, wheelAxis: 'horizontal' }, 1_000), 1);
  assert.equal(input.step({ wheel: -1, wheelAxis: 'vertical' }, 1_030), 0);
  assert.equal(input.step({ wheel: 1, wheelAxis: 'horizontal' }, 1_060), 1);
  assert.equal(input.step({ wheel: -1, wheelAxis: 'vertical' }, 1_400), -1, 'a deliberate axis change wins after the gesture settles');
});
