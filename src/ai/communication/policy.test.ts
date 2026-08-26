import assert from 'node:assert/strict';
import test from 'node:test';
import { CommunicationPolicy } from './policy.ts';

const speak = { mode: 'speak', intent: 'react', text: 'That changes things.' } as const;

test('autoreply accepts speech while ambient suppresses routine chatter', () => {
  const policy = new CommunicationPolicy();
  assert.equal(policy.decide({ mode: 'autoreply', proposal: speak, seat: 0, actionNumber: 1, actionSalience: 0.05, requiredResponse: false }).communication.mode, 'speak');
  policy.reset();
  const ambient = policy.decide({ mode: 'ambient', proposal: speak, seat: 0, actionNumber: 1, actionSalience: 0.05, requiredResponse: false });
  assert.equal(ambient.communication.mode, 'silent');
  assert.equal(ambient.reason, 'below ambient threshold');
});

test('ambient always admits a proposed direct response and rate-limits monologues', () => {
  const policy = new CommunicationPolicy();
  const reply = policy.decide({ mode: 'ambient', proposal: { ...speak, intent: 'reply' }, seat: 1, actionNumber: 2, actionSalience: 0, requiredResponse: true });
  assert.equal(reply.communication.mode, 'speak');
  const monologue = { mode: 'speak', intent: 'monologue', text: 'A dramatic little speech.' } as const;
  assert.equal(policy.decide({ mode: 'ambient', proposal: monologue, seat: 1, actionNumber: 3, actionSalience: 0.8, requiredResponse: false }).communication.mode, 'silent');
});
