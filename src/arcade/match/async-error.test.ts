import assert from 'node:assert/strict';
import test from 'node:test';

import { reportUnexpectedAsyncError } from './async-error.ts';

test('expected cancellation stays quiet; unexpected async failures are reported', () => {
  const errors: unknown[] = [];
  reportUnexpectedAsyncError(new Error('cancelled'), true, (error) => errors.push(error));
  reportUnexpectedAsyncError('broken animation', false, (error) => errors.push(error));
  assert.deepEqual(errors, ['broken animation']);
});
