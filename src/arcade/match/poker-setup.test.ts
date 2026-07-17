import assert from 'node:assert/strict';
import test from 'node:test';

import {
  modelTypeDropdown,
  modeDropdown,
  playersDropdown,
  pokerPreviewSeats,
  pokerSetupSelection,
} from './poker-setup.ts';

test('heads-up model type swaps the visible and selected opponent catalog', () => {
  const previousMode = modeDropdown.index;
  const previousPlayers = playersDropdown.index;
  const previousType = modelTypeDropdown.index;
  try {
    modeDropdown.pick(0);
    playersDropdown.pick(0);

    modelTypeDropdown.pick(0);
    assert.deepEqual(pokerPreviewSeats().map((seat) => seat.creator), [undefined, 'anthropic']);
    assert.deepEqual(pokerSetupSelection(), [
      { kind: 'human' },
      { kind: 'ai', model: 'anthropic/claude-haiku-4.5', runtime: 'text' },
    ]);

    modelTypeDropdown.pick(1);
    const realtime = pokerPreviewSeats()[1];
    assert.equal(realtime.creator, 'openai');
    assert.equal(realtime.label, 'gpt-realtime-2');
  } finally {
    modeDropdown.pick(previousMode);
    playersDropdown.pick(previousPlayers);
    modelTypeDropdown.pick(previousType);
  }
});
