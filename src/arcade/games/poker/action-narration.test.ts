import assert from 'node:assert/strict';
import test from 'node:test';
import { actionNarration } from './poker-scene.ts';

test('actionNarration: third person for opponents (verb + s, amounts as money)', () => {
  assert.equal(actionNarration('Claude', { type: 'fold' }, false), 'Claude folds');
  assert.equal(actionNarration('Claude', { type: 'check' }, false), 'Claude checks');
  assert.equal(actionNarration('Claude', { type: 'call' }, false), 'Claude calls');
  assert.equal(actionNarration('Claude', { type: 'bet', amount: 40 }, false), 'Claude bets $40');
  assert.equal(actionNarration('Claude', { type: 'raise', to: 1200 }, false), 'Claude raises to $1,200');
  assert.equal(actionNarration('Claude', { type: 'allin' }, false), 'Claude goes all-in');
});

test('actionNarration: second person for the human hero (no trailing s)', () => {
  assert.equal(actionNarration('You', { type: 'fold' }, true), 'You fold');
  assert.equal(actionNarration('You', { type: 'call' }, true), 'You call');
  assert.equal(actionNarration('You', { type: 'raise', to: 80 }, true), 'You raise to $80');
  assert.equal(actionNarration('You', { type: 'allin' }, true), 'You go all-in');
});
