import assert from 'node:assert/strict';
import test from 'node:test';
import type { KeyEvent } from '../../platform/input.ts';
import { installKeymap, type KeyHandlers } from './keybindings.ts';

const D_KEY: KeyEvent = {
  name: 'd',
  raw: 'd',
  sequence: 'd',
  ctrl: false,
  shift: false,
  meta: false,
  eventType: 'press',
};

test('d globally cycles display mode and is advertised by the controls modal', () => {
  const calls: string[] = [];
  const handlers = new Proxy({}, {
    get: (_target, prop) => () => calls.push(String(prop)),
  }) as KeyHandlers;
  const keymap = installKeymap(handlers);

  for (const layer of ['prism', 'menu', 'chess', 'poker', 'catan', 'catan-tiles']) {
    keymap.setBase(layer);
    calls.length = 0;
    assert.equal(keymap.handle(D_KEY), true, `${layer} should handle d`);
    assert.deepEqual(calls, ['cycleMode']);

    assert.deepEqual(
      keymap.activeBindings().find((binding) => binding.key === 'd'),
      { key: 'd', title: 'Cycle display style', layer: 'global', id: 'view.cycleRenderMode' },
      `${layer} controls should advertise d as a general binding`,
    );
  }

  keymap.setBase('poker');
  keymap.pushContext('shortcuts', true);
  calls.length = 0;
  assert.equal(keymap.handle(D_KEY), true);
  assert.deepEqual(calls, ['cycleMode'], 'd should keep cycling while the controls modal is open');
});

test('illegal moves has no hidden shortcut while eval remains keyboard-adjustable', () => {
  const handlers = new Proxy({}, { get: () => () => {} }) as KeyHandlers;
  const keymap = installKeymap(handlers);
  keymap.setBase('chess');
  assert.equal(keymap.commands().some((command) => command.id === 'chess.toggleIllegal'), false);
  assert.equal(keymap.activeBindings().some((binding) => binding.key === 'i'), false);
  assert.equal(keymap.activeBindings().some((binding) => binding.key === 'e' && binding.id === 'chess.toggleEvalBar'), true);
});
