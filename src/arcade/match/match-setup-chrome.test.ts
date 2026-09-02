import assert from 'node:assert/strict';
import test from 'node:test';
import { ARCADE_OUTLINE_CONTROL } from '../theme.ts';
import { MATCH_START_DISABLED, cancelMatchButton, matchSetupHeading, newMatchButton, startMatchButton } from './match-setup-chrome.ts';

test('shared match setup chrome keeps neutral new-match and semantic start states consistent', () => {
  const fresh = newMatchButton('new', () => {});
  assert.equal(fresh.text, 'new match');
  assert.equal(fresh.style.border, 'round');
  assert.equal(fresh.style.color, ARCADE_OUTLINE_CONTROL.neutralText);

  const ready = startMatchButton('start', () => {});
  assert.equal(ready.text, 'start');
  assert.equal(ready.disabled, false);

  const disabled = startMatchButton('disabled', undefined);
  assert.equal(disabled.disabled, true);
  assert.equal(disabled.style.color, MATCH_START_DISABLED);

  assert.equal(cancelMatchButton('cancel', () => {}).text, 'cancel');
  assert.equal(matchSetupHeading().text, 'new match');
});
