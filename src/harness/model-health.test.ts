import assert from 'node:assert/strict';
import test from 'node:test';
import { checkModelHealth } from './model-health.ts';

test('an empty model set is healthy', async () => {
  assert.deepEqual(await checkModelHealth([]), []);
});

test('an already-aborted health check rejects without converting cancellation to model health', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => checkModelHealth(['test/model'], { signal: controller.signal }));
});

test('health checks deduplicate models and bound concurrent requests to two', async () => {
  const started: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const pending = checkModelHealth(['a/model', 'a/model', 'b/model', 'c/model'], {
    generate: async (model) => {
      started.push(model);
      await gate;
    },
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(started.sort(), ['a/model', 'b/model']);
  release();
  assert.deepEqual(await pending, []);
  assert.deepEqual(started.sort(), ['a/model', 'b/model', 'c/model']);
});

test('queued health checks share one overall deadline', async () => {
  const started: string[] = [];
  const failures = await checkModelHealth(['a', 'b', 'c', 'd'], {
    timeoutMs: 10,
    generate: async (model, signal) => {
      started.push(model);
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
      throw signal.reason;
    },
  });
  assert.deepEqual(failures, []);
  assert.deepEqual(started.sort(), ['a', 'b']);
});

test('health checks preserve persistent resolver failures', async () => {
  const error = Object.assign(new Error('out of credit'), {
    statusCode: 402,
    responseBody: JSON.stringify({ error: { type: 'insufficient_funds' } }),
  });
  const [failure] = await checkModelHealth(['a/model'], { generate: async () => { throw error; } });
  assert.equal(failure?.notice.code, 'insufficient_funds');
  assert.equal(failure?.notice.persistent, true);
});

test('temporary preflight failures do not block match startup', async () => {
  const error = Object.assign(new Error('unavailable'), { statusCode: 503 });
  assert.deepEqual(await checkModelHealth(['a/model'], { generate: async () => { throw error; } }), []);
});

test('health checks return persistent failures in selector order', async () => {
  const persistent = Object.assign(new Error('out of credit'), {
    statusCode: 402,
    responseBody: JSON.stringify({ error: { type: 'insufficient_funds' } }),
  });
  const failures = await checkModelHealth(['a/model', 'b/model', 'a/model', 'c/model'], {
    generate: async (model) => {
      if (model !== 'b/model') throw persistent;
    },
  });
  assert.deepEqual(failures.map((failure) => failure.model), ['a/model', 'c/model']);
});

test('payment-method failures preserve the add-card resolver for the shared error modal', async () => {
  const error = Object.assign(new Error('payment method required'), {
    statusCode: 403,
    responseBody: JSON.stringify({ error: { type: 'customer_verification_required' } }),
  });
  const [failure] = await checkModelHealth(['a/model'], { generate: async () => { throw error; } });
  assert.equal(failure?.notice.title, 'payment method required');
  assert.equal(failure?.notice.action?.label, 'add credit card');
});
