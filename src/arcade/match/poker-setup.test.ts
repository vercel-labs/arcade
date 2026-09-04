import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDefaultSeats } from './default-seats.ts';
import { pickerCreators } from './models.ts';

import {
  buildPokerSetupPanel,
  modeDropdown,
  playersDropdown,
  pokerPreviewSeats,
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

    assert.deepEqual(pokerPreviewSeats().map((seat) => seat.creator), [undefined, 'anthropic']);
    assert.deepEqual(pokerSetupSelection(), [
      { kind: 'human' },
      { kind: 'ai', model: resolveDefaultSeats(pickerCreators(), 6)[1]!.model, runtime: 'text' },
    ]);

    const visibleText = collectNodes(buildPokerSetupPanel()).flatMap((node) => node.text ?? []);
    assert.equal(visibleText.some((text) => /model type|realtime|voice/i.test(text)), false);
  } finally {
    modeDropdown.pick(previousMode);
    playersDropdown.pick(previousPlayers);
  }
});
