import assert from 'node:assert/strict';
import test from 'node:test';
import { AccountOperations } from './account-operations.ts';

test('a newer account operation invalidates delayed work before it can commit', async () => {
  const operations = new AccountOperations();
  const first = operations.begin();
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => { release = resolve; });
  let committed = false;
  const completion = (async () => {
    await delayed;
    if (first.isCurrent()) committed = true;
  })();

  const second = operations.begin();
  release();
  await completion;
  assert.equal(first.isCurrent(), false);
  assert.equal(second.isCurrent(), true);
  assert.equal(committed, false);
});

test('sign-out invalidation makes the active account operation stale', () => {
  const operations = new AccountOperations();
  const active = operations.begin();
  operations.invalidate();
  assert.equal(active.isCurrent(), false);
});
