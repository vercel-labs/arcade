import assert from 'node:assert/strict';
import test from 'node:test';
import type { KeyEvent } from '../../platform/input.ts';
import { escapeBackRequiresConfirmation, installKeymap, type KeyHandlers } from './keybindings.ts';

const D_KEY: KeyEvent = {
  name: 'd',
  raw: 'd',
  sequence: 'd',
  ctrl: false,
  shift: false,
  meta: false,
  eventType: 'press',
};
const ESCAPE_KEY: KeyEvent = {
  name: 'escape',
  raw: '\x1b',
  sequence: '\x1b',
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

  for (const layer of ['prism', 'menu', 'chess', 'poker', 'islanders', 'islanders-tiles']) {
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

test('Escape backs out of every non-prism screen instead of falling through to quit', () => {
  const calls: string[] = [];
  const handlers = new Proxy({}, {
    get: (_target, prop) => () => calls.push(String(prop)),
  }) as KeyHandlers;
  const keymap = installKeymap(handlers);

  for (const layer of ['chess', 'cards', 'logos', 'ui', 'poker', 'audio', 'islanders', 'islanders-tiles']) {
    keymap.setBase(layer);
    calls.length = 0;
    assert.equal(keymap.handle(ESCAPE_KEY), true, `${layer} should handle Escape`);
    assert.deepEqual(calls, ['escBack'], `${layer} Escape should back out through the shared navigation path`);
  }
});

test('played games confirm before Escape abandons the session', () => {
  for (const mode of ['chess-game', 'poker', 'islanders']) assert.equal(escapeBackRequiresConfirmation(mode), true, mode);
  for (const mode of ['cards', 'logos', 'ui', 'audio', 'islanders-tiles']) assert.equal(escapeBackRequiresConfirmation(mode), false, mode);
});

test('Escape closes Islanders overlays before navigating away from the game', () => {
  const calls: string[] = [];
  const handlers = new Proxy({}, {
    get: (_target, prop) => () => calls.push(String(prop)),
  }) as KeyHandlers;
  const keymap = installKeymap(handlers);

  for (const [layer, handler] of [
    ['islanders-menu', 'closeIslandersMenu'],
    ['islanders-piece-edit', 'closeIslandersPieceEdit'],
    ['islanders-game-menu', 'closeIslandersGameMenu'],
  ] as const) {
    keymap.setBase(layer === 'islanders-game-menu' ? 'islanders' : 'islanders-tiles');
    keymap.pushContext(layer, true);
    calls.length = 0;
    assert.equal(keymap.handle(ESCAPE_KEY), true);
    assert.deepEqual(calls, [handler]);
  }
});

test('Islanders shares game menu and camera keyboard controls with the other 3D games', () => {
  const calls: string[] = [];
  const orbit = { resetView: () => calls.push('resetView'), pan: (x: number, y: number) => calls.push(`pan:${x}:${y}`) };
  const handlers = new Proxy({ activeOrbit: () => orbit }, {
    get: (target, prop) => prop in target ? target[prop as keyof typeof target] : () => calls.push(String(prop)),
  }) as unknown as KeyHandlers;
  const keymap = installKeymap(handlers);

  for (const [layer, openHandler] of [['islanders', 'openIslandersGameMenu'], ['islanders-tiles', 'openIslandersMenu']] as const) {
    keymap.setBase(layer);
    calls.length = 0;
    assert.equal(keymap.handle({ ...D_KEY, name: 'm', raw: 'm', sequence: 'm' }), true);
    assert.deepEqual(calls, [openHandler]);
    calls.length = 0;
    assert.equal(keymap.handle({ ...D_KEY, name: 'r', raw: 'r', sequence: 'r' }), true);
    assert.deepEqual(calls, ['resetView']);
    calls.length = 0;
    assert.equal(keymap.handle({ ...D_KEY, name: 'left', raw: '', sequence: '\x1b[D' }), true);
    assert.deepEqual(calls, ['pan:16:0']);
  }
});
