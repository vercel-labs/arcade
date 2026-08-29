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

test('ambient suppresses repeated speech from the same seat', () => {
  const policy = new CommunicationPolicy();
  const first = policy.decide({ mode: 'ambient', proposal: speak, seat: 0, actionNumber: 10, actionSalience: 0.8, requiredResponse: false });
  assert.equal(first.communication.mode, 'speak');
  const repeated = policy.decide({ mode: 'ambient', proposal: speak, seat: 0, actionNumber: 20, actionSalience: 0.8, requiredResponse: false });
  assert.equal(repeated.communication.mode, 'silent');
  assert.equal(repeated.components?.duplicatePenalty, 0.55);
});

test('ambient catches semantic repeats even when wording changes or another line intervenes', () => {
  const policy = new CommunicationPolicy();
  const first = policy.decide({
    mode: 'ambient',
    proposal: { mode: 'speak', intent: 'negotiate', text: 'Claude or GPT, anyone want my wheat for a brick from those hills?' },
    seat: 0,
    actionNumber: 50,
    actionSalience: 0.8,
    requiredResponse: false,
  });
  assert.equal(first.communication.mode, 'speak');
  policy.decide({
    mode: 'ambient',
    proposal: { mode: 'speak', intent: 'react', text: 'That robber move changes the board.' },
    seat: 0,
    actionNumber: 52,
    actionSalience: 0.8,
    requiredResponse: false,
  });
  const repeated = policy.decide({
    mode: 'ambient',
    proposal: { mode: 'speak', intent: 'negotiate', text: 'GPT, my wheat for your brick instead? Claude, are you in?' },
    seat: 0,
    actionNumber: 54,
    actionSalience: 0.8,
    requiredResponse: false,
  });
  assert.equal(repeated.communication.mode, 'silent');
  assert.equal(repeated.components?.duplicatePenalty, 0.55);
});

test('ambient remembers exact repeats beyond the immediately previous speech', () => {
  const policy = new CommunicationPolicy();
  const robber = { mode: 'speak', intent: 'react', text: 'Moving the robber to your 5 grain hex—hope you do not mind sharing.' } as const;
  assert.equal(policy.decide({ mode: 'ambient', proposal: robber, seat: 0, actionNumber: 100, actionSalience: 0.8, requiredResponse: false }).communication.mode, 'speak');
  policy.decide({ mode: 'ambient', proposal: { ...speak, text: 'No deal on that trade.' }, seat: 0, actionNumber: 101, actionSalience: 0.8, requiredResponse: false });
  const repeated = policy.decide({ mode: 'ambient', proposal: robber, seat: 0, actionNumber: 107, actionSalience: 0.8, requiredResponse: false });
  assert.equal(repeated.communication.mode, 'silent');
  assert.equal(repeated.components?.duplicatePenalty, 0.55);
});
