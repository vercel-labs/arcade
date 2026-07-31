import assert from 'node:assert/strict';
import test from 'node:test';

import { createShutdownCoordinator, type ShutdownReason } from './lifecycle.ts';

function deferred(): { promise: Promise<void>; resolve(): void; reject(error: unknown): void } {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

test('shutdown cleans up once, reports crashes, flushes, then exits', async () => {
  const pending = deferred();
  const calls: string[] = [];
  const shutdown = createShutdownCoordinator({
    cleanup: [
      (reason) => calls.push(`game:${reason}`),
      () => {
        calls.push('broken-cleanup');
        throw new Error('cleanup failed');
      },
      () => calls.push('terminal'),
    ],
    flush: (capMs) => {
      calls.push(`flush:${capMs}`);
      return pending.promise;
    },
    report: (error) => calls.push(`report:${String(error)}`),
    exit: (code) => calls.push(`exit:${code}`),
  });

  shutdown.crash('boom');
  shutdown.signal(); // idempotent: a later signal cannot start a second shutdown.

  assert.equal(shutdown.isFinalizing(), true);
  assert.deepEqual(calls, [
    'game:process_exit_recovered',
    'broken-cleanup',
    'terminal',
    'report:boom',
    'flush:400',
  ]);

  pending.resolve();
  await settle();
  assert.deepEqual(calls.slice(-1), ['exit:1']);
});

test('shutdown exits even when flushing rejects or throws synchronously', async () => {
  const exits: number[] = [];
  const rejected = createShutdownCoordinator({
    cleanup: [],
    flush: async () => {
      throw new Error('offline');
    },
    report() {},
    exit: (code) => exits.push(code),
  });
  rejected.signal();
  await settle();

  const thrown = createShutdownCoordinator({
    cleanup: [],
    flush: () => {
      throw new Error('not initialized');
    },
    report() {},
    exit: (code) => exits.push(code),
  });
  thrown.finalize('navigation' satisfies ShutdownReason, 7);

  assert.deepEqual(exits, [0, 7]);
});
