import assert from 'node:assert/strict';
import test from 'node:test';
import type { Node } from '../../tui/index.ts';
import { buildMatchSetup, matchSetupOptions } from './setup.ts';

function findNode(node: Node, id: string): Node | undefined {
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return undefined;
}

test('Chess setup defaults eval and illegal moves off and places them after both sides', () => {
  const root = buildMatchSetup({ x: 0, y: 0, w: 140, h: 50 }, { onStart: () => {}, onCancel: () => {} });
  assert.deepEqual(matchSetupOptions(), { evalBar: false, illegalMoves: false });
  assert.ok(findNode(root, 'setup-eval'));
  assert.ok(findNode(root, 'setup-illegal'));

  findNode(root, 'setup-eval')?.onClick?.();
  findNode(root, 'setup-illegal')?.onClick?.();
  assert.deepEqual(matchSetupOptions(), { evalBar: true, illegalMoves: true });

  const reset = buildMatchSetup({ x: 0, y: 0, w: 140, h: 50 }, { onStart: () => {}, onCancel: () => {} });
  findNode(reset, 'setup-eval')?.onClick?.();
  findNode(reset, 'setup-illegal')?.onClick?.();
});

test('Chess setup keeps the menu available without showing chat', () => {
  let opened = false;
  const root = buildMatchSetup(
    { x: 0, y: 0, w: 140, h: 50 },
    { onStart: () => {}, onCancel: () => {}, onOpenMenu: () => { opened = true; } },
  );

  assert.equal(findNode(root, 'chat-open'), undefined);
  const menu = findNode(root, 'chess-menu');
  assert.ok(menu);
  menu.onClick?.();
  assert.equal(opened, true);
});
