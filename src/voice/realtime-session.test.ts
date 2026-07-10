import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RealtimeSession, type RealtimeCodec, type RealtimeHandlers, type RealtimeSocket } from './realtime-session.ts';

// A mock socket + identity codec: client events pass through unchanged, server
// frames are already in the normalized { type, … } shape the session reads. Lets
// us exercise the whole event contract headless — no network, no key.
function harness(handlers: RealtimeHandlers = {}) {
  const sent: string[] = [];
  const listeners: Record<string, (arg?: unknown) => void> = {};
  const socket: RealtimeSocket = {
    send: (d) => sent.push(d),
    close: () => {},
    on: (ev, cb) => {
      listeners[ev] = cb;
    },
  };
  const codec: RealtimeCodec = { serializeClientEvent: (e) => e, parseServerEvent: (d) => d };
  const session = new RealtimeSession(codec, socket, handlers);
  listeners.open?.(); // connect → flush queue + open status
  const recv = (obj: unknown): void => listeners.message?.(JSON.stringify(obj));
  const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
  return { session, sent, recv, flush };
}

test('updateSession carries tool definitions in the session-update', async () => {
  const { session, sent, flush } = harness();
  session.updateSession({
    tools: [{ type: 'function', name: 'act', description: 'take a poker action', parameters: { type: 'object', properties: {} } }],
  });
  await flush();
  const update = sent.find((s) => s.includes('session-update'));
  assert.ok(update, 'a session-update was sent');
  assert.match(update!, /"tools"/);
  assert.match(update!, /"name":"act"/);
});

test('sendContext adds a text item WITHOUT asking for a response', async () => {
  const { session, sent, flush } = harness();
  session.sendContext('Board: Ah Kd 7c. It is your turn.');
  await flush();
  assert.equal(sent.length, 1, 'exactly one client event');
  assert.match(sent[0], /conversation-item-create/);
  assert.match(sent[0], /It is your turn/);
  assert.ok(!sent[0].includes('response-create'), 'no response-create — silent knowledge update');
});

test('respond(instructions) sends response-create with steering instructions', async () => {
  const statuses: string[] = [];
  const { session, sent, flush } = harness({ onStatus: (s) => statuses.push(s) });
  session.respond("It's your turn — call your action.");
  await flush();
  const resp = sent.find((s) => s.includes('response-create'));
  assert.ok(resp, 'a response-create was sent');
  assert.match(resp!, /call your action/);
  assert.ok(statuses.includes('responding'), 'reports responding');
});

test('function-call-arguments-done fans out to onFunctionCall', () => {
  const calls: { callId: string; name: string; argumentsJson: string }[] = [];
  const { recv } = harness({ onFunctionCall: (c) => calls.push(c) });
  recv({ type: 'function-call-arguments-done', callId: 'call_1', name: 'act', arguments: '{"action":"raise","amount":120}' });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { callId: 'call_1', name: 'act', argumentsJson: '{"action":"raise","amount":120}' });
});

test('a function-call with no name/callId is ignored (no throw)', () => {
  const calls: unknown[] = [];
  const { recv } = harness({ onFunctionCall: (c) => calls.push(c) });
  recv({ type: 'function-call-arguments-done', arguments: '{}' }); // malformed — missing name/callId
  assert.equal(calls.length, 0);
});

test('sendFunctionResult returns the tool output then asks the model to continue', async () => {
  const { session, sent, flush } = harness();
  session.sendFunctionResult('call_1', 'act', JSON.stringify({ ok: true }));
  await flush();
  assert.equal(sent.length, 2, 'function-call-output + response-create');
  const item = (JSON.parse(sent[0]) as { item: { type: string; callId: string; name: string; output: string } }).item;
  assert.equal(item.type, 'function-call-output');
  assert.equal(item.callId, 'call_1');
  assert.equal(item.name, 'act');
  assert.deepEqual(JSON.parse(item.output), { ok: true }); // output is a JSON string
  assert.match(sent[1], /response-create/);
});
