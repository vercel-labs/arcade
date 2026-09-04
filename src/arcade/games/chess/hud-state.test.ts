import assert from 'node:assert/strict';
import test from 'node:test';
import { Box, type Node } from '../../../tui/index.ts';
import { buildChessGameRoot } from './hud.ts';

function findNode(node: Node, id: string): Node | undefined {
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return undefined;
}

function build(chatActive: boolean, chatVisible: boolean): Node {
  return buildChessGameRoot({ x: 0, y: 0, w: 140, h: 50 }, Box({}), {
    minimized: true,
    onToggle: () => {},
    onCopy: () => {},
    commentary: null,
    t: 0,
    evalVisible: false,
    evalCp: 0,
    evalResult: null,
    chatVisible,
    onToggleChat: () => {},
    onOpenMenu: () => {},
    chatActive,
  });
}

test('free-play Chess exposes menu but no chat affordance or stale open panel', () => {
  const root = build(false, true);
  assert.ok(findNode(root, 'chess-menu'));
  assert.equal(findNode(root, 'chat-open'), undefined);
  assert.equal(findNode(root, 'chat-close'), undefined);
});

test('an AI Chess match exposes its collapsed chat affordance', () => {
  const root = build(true, false);
  assert.ok(findNode(root, 'chess-menu'));
  assert.ok(findNode(root, 'chat-open'));
  assert.equal(findNode(root, 'chat-close'), undefined);
});
