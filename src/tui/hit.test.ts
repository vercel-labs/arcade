import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hitGesture, hitKey, hitTest } from './hit.ts';
import { layout } from './layout.ts';
import { Box, Text } from './nodes.ts';
import type { Node } from './types.ts';

// A scrollable (onMouse + onKey) whose rows are themselves clickable (onClick only) —
// the leaderboard's standings list. Wheel and scroll keys must reach the scrollable,
// not stop at the row.
function listWithClickableRows(): { root: Node; scrollable: Node; row: Node } {
  const row: Node = { kind: 'box', id: 'row-1', style: { width: 20, height: 1 }, onClick: () => {}, children: [Text({ text: 'a row' })] };
  const scrollable: Node = {
    kind: 'box',
    id: 'list',
    style: { width: 20, height: 3, flexDirection: 'column' },
    onMouse: () => true,
    onKey: () => true,
    children: [row],
  };
  const root = Box({ width: 40, height: 10 }, [scrollable]);
  layout(root, { x: 0, y: 0, w: 40, h: 10 });
  return { root, scrollable, row };
}

test('hitTest returns the innermost interactive node (the clickable row)', () => {
  const { root, row } = listWithClickableRows();
  assert.equal(hitTest(root, 2, 0)?.id, row.id);
});

test('hitGesture skips the clickable row and finds the scrollable', () => {
  const { root, scrollable } = listWithClickableRows();
  // Regression: routing the wheel via hitTest landed on the row, which has no
  // onMouse, so the list silently would not scroll.
  assert.equal(hitGesture(root, 2, 0)?.id, scrollable.id);
});

test('hitKey skips the clickable row and finds the key handler', () => {
  const { root, scrollable } = listWithClickableRows();
  assert.equal(hitKey(root, 2, 0)?.id, scrollable.id);
});

test('hitGesture returns null where nothing handles gestures', () => {
  const root = Box({ width: 10, height: 3 }, [Text({ text: 'inert' })]);
  layout(root, { x: 0, y: 0, w: 10, h: 3 });
  assert.equal(hitGesture(root, 1, 0), null);
});

test('hitGesture prefers the innermost gesture handler when they nest', () => {
  const inner: Node = { kind: 'box', id: 'inner', style: { width: 5, height: 1 }, onMouse: () => true };
  const outer: Node = { kind: 'box', id: 'outer', style: { width: 10, height: 2, flexDirection: 'column' }, onMouse: () => true, children: [inner] };
  const root = Box({ width: 10, height: 2 }, [outer]);
  layout(root, { x: 0, y: 0, w: 10, h: 2 });
  assert.equal(hitGesture(root, 1, 0)?.id, 'inner');
  // Outside the inner box's row, the outer handler is the target.
  assert.equal(hitGesture(root, 1, 1)?.id, 'outer');
});
