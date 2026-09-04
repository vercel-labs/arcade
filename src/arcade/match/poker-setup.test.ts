import assert from 'node:assert/strict';
import test from 'node:test';
import { selectModelSeat } from './model-seat-picker.ts';

import {
  buildPokerSetupPanel,
  modeDropdown,
  playersDropdown,
  pokerPreviewSeats,
  pokerSeatPicker,
  pokerSetupReady,
  pokerSetupSelection,
} from './poker-setup.ts';

const collectNodes = (root: import('../../tui/index.ts').Node): import('../../tui/index.ts').Node[] =>
  [root, ...(root.children ?? []).flatMap(collectNodes)];

test('poker setup renders a persistent failed health row', () => {
  const panel = buildPokerSetupPanel({ lines: ['claude failed health check.'], failed: true });
  const status = collectNodes(panel).find((node) => node.text?.includes('failed health check'));
  assert.equal(status?.style.color, 'danger');
});

test('heads-up setup always selects a text model and exposes no voice controls', () => {
  const previousMode = modeDropdown.index;
  const previousPlayers = playersDropdown.index;
  try {
    modeDropdown.pick(0);
    playersDropdown.pick(0);

    // The seat opens on its default creator with the model left to pick: the wisp previews
    // by creator while Start waits.
    assert.deepEqual(pokerPreviewSeats().map((seat) => seat.creator), [undefined, 'openai'], 'heads-up, your one opponent is the top-ranked creator');
    assert.equal(pokerSetupReady(), false);
    assert.equal(pokerSetupSelection(), null);
    selectModelSeat(pokerSeatPicker(1), 'anthropic', 'anthropic/claude-haiku-4.5');
    assert.deepEqual(pokerSetupSelection(), [
      { kind: 'human' },
      { kind: 'ai', model: 'anthropic/claude-haiku-4.5', runtime: 'text' },
    ]);

    const visibleText = collectNodes(buildPokerSetupPanel()).flatMap((node) => node.text ?? []);
    assert.equal(visibleText.some((text) => /model type|realtime|voice/i.test(text)), false);
  } finally {
    modeDropdown.pick(previousMode);
    playersDropdown.pick(previousPlayers);
  }
});

test('switching between play and spectate re-deals untouched seats so OpenAI leads either way', () => {
  selectModelSeat(pokerSeatPicker(1), 'google'); // back to a creator with no model: an untouched seat
  assert.equal(pokerSeatPicker(1).modelId, null);
  modeDropdown.pick(1); // spectate: seat 1 is a model too
  assert.deepEqual([0, 1, 2].map((i) => pokerSeatPicker(i).creator), ['openai', 'anthropic', 'google']);
  modeDropdown.pick(0); // play: you take seat 1, the opponents shift down
  assert.deepEqual([1, 2, 3].map((i) => pokerSeatPicker(i).creator), ['openai', 'anthropic', 'google']);

  // A seat the player has already committed keeps its model through a mode switch.
  selectModelSeat(pokerSeatPicker(2), 'google');
  selectModelSeat(pokerSeatPicker(2), 'google', pokerSeatPicker(2).models[0]!.id);
  modeDropdown.pick(1);
  assert.equal(pokerSeatPicker(2).creator, 'google');
  assert.ok(pokerSeatPicker(2).modelId);
  modeDropdown.pick(0);
  selectModelSeat(pokerSeatPicker(2), 'anthropic'); // leave the shared pickers untouched for later tests
});
