import assert from 'node:assert/strict';
import test from 'node:test';
import { Box, Button } from './nodes.ts';
import { Modal } from './components/modal.ts';
import { Screen } from './screen.ts';

const enter = { name: 'enter', raw: '\r', sequence: '\r', ctrl: false, shift: false, meta: false, eventType: 'press' as const };
const tab = { name: 'tab', raw: '\t', sequence: '\t', ctrl: false, shift: false, meta: false, eventType: 'press' as const };

test('global overlay survives screen root replacement and only captures its own bounds', () => {
  const screen = new Screen(80, 24);
  let clicked = 0;
  screen.setRoot(Box({ width: 80, height: 24 }));
  screen.setGlobalOverlay(Box({ position: 'absolute', top: 1, right: 2, width: 20 }, [Button({ id: 'notice-action', label: 'resolve', onClick: () => clicked++ })]));
  screen.setRoot(Box({ width: 80, height: 24 }, [Button({ id: 'scene-action', label: 'scene' })]));
  screen.setFocus('notice-action');
  assert.equal(screen.handleKey(enter), true);
  assert.equal(clicked, 1);
  assert.equal(screen.pointerDown(1, 20), null, 'overlay does not create a full-screen hit surface');
});

test('clearing a global overlay removes its focus targets', () => {
  const screen = new Screen(40, 12);
  screen.setRoot(Box({ width: 40, height: 12 }));
  screen.setGlobalOverlay(Button({ id: 'notice-close', label: 'close' }));
  screen.setFocus('notice-close');
  assert.equal(screen.handleKey(enter), true);
  screen.setGlobalOverlay(null);
  assert.equal(screen.handleKey(enter), false);
});

test('a modal global overlay stays centered and consumes scene clicks', () => {
  const screen = new Screen(80, 24);
  let sceneClicks = 0;
  let dismissals = 0;
  screen.setRoot(Box({ width: 80, height: 24 }, [Button({ id: 'scene-action', label: 'scene', onClick: () => sceneClicks++ })]), { x: 0, y: 0, w: 80, h: 24 });
  const card = Box({ width: 20, height: 6 });
  screen.setGlobalOverlay(Modal(card, { onDismiss: () => dismissals++ }));

  type LayoutNode = { layout?: { x: number; y: number; w: number; h: number }; children?: LayoutNode[] };
  const root = (screen as unknown as { root: LayoutNode }).root;
  const findCard = (node: LayoutNode): LayoutNode | undefined =>
    node.layout?.w === 20 && node.layout.h === 6 ? node : node.children?.map(findCard).find(Boolean);
  assert.deepEqual(findCard(root)?.layout, { x: 30, y: 9, w: 20, h: 6 });

  screen.pointerDown(1, 1);
  assert.equal(dismissals, 1);
  assert.equal(sceneClicks, 0);
});

test('a global overlay focus scope traps keyboard activation above the base root', () => {
  const screen = new Screen(40, 12);
  let sceneClicks = 0;
  let overlayClicks = 0;
  screen.setRoot(Box({ width: 40, height: 12 }, [Button({ id: 'scene-action', label: 'scene', onClick: () => sceneClicks++ })]));
  const overlay = Box({ width: 40, height: 12 }, [
    Button({ id: 'overlay-action', label: 'continue', onClick: () => overlayClicks++ }),
    Button({ id: 'overlay-close', label: 'close' }),
  ]);
  screen.setGlobalOverlay(overlay, overlay);
  screen.setFocus('overlay-close');

  assert.equal(screen.handleKey(tab), true);
  assert.equal(screen.handleKey(enter), true);
  assert.equal(overlayClicks, 1, 'Tab wraps within the blocking overlay');
  assert.equal(sceneClicks, 0, 'the obscured base action cannot receive keyboard activation');
});
