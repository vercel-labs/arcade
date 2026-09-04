import assert from 'node:assert/strict';
import test from 'node:test';
import { createTerminalSessionPreparer, type TerminalSession } from './terminal-session-client';

const session: TerminalSession = {
  url: 'wss://example.test/session',
  token: 'token',
  start: { command: '/bin/bash', args: [], env: [], cwd: '/', cols: 100, rows: 48 },
  expiresInMs: 1_200_000,
};

test('base warming does not allocate a visitor session', async () => {
  const bodies: unknown[] = [];
  const preparer = createTerminalSessionPreparer(async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(null, { status: 204 });
  });

  await preparer.warmBase();
  assert.deepEqual(bodies, [{ warmOnly: true }]);
});

test('intent preparation and terminal open share one visitor session request', async () => {
  const bodies: unknown[] = [];
  const preparer = createTerminalSessionPreparer(async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json(session);
  });

  preparer.prepareSession();
  assert.deepEqual(await preparer.acquireSession(132, 50), session);
  assert.deepEqual(bodies, [{ cols: 100, rows: 48 }]);
});
