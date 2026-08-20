import assert from 'node:assert/strict';
import test from 'node:test';
import { CoverFlowWheelInput } from './coverflow-input.ts';

test('Cover Flow keeps precise nudges and boosts continuing horizontal swipes', () => {
  const input = new CoverFlowWheelInput();

  assert.equal(input.step({ wheel: 1, wheelAxis: 'horizontal' }, 1_000), 1);
  assert.equal(input.step({ wheel: 1, wheelAxis: 'horizontal' }, 1_100), 2);
  assert.equal(input.step({ wheel: -1, wheelAxis: 'horizontal' }, 1_150), -1);
  assert.equal(input.step({ wheel: -1, wheelAxis: 'horizontal' }, 1_500), -1);
});

test('vertical scrolling remains one cover per report and ends horizontal acceleration', () => {
  const input = new CoverFlowWheelInput();

  assert.equal(input.step({ wheel: 1, wheelAxis: 'horizontal' }, 1_000), 1);
  assert.equal(input.step({ wheel: 1, wheelAxis: 'vertical' }, 1_050), 1);
  assert.equal(input.step({ wheel: 1, wheelAxis: 'horizontal' }, 1_100), 1);
  assert.equal(input.step({ wheel: -1, wheelAxis: 'vertical' }, 1_150), -1);
});
