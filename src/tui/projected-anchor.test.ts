import assert from 'node:assert/strict';
import test from 'node:test';
import { ProjectedAnchor } from './components/projected-anchor.ts';
import { Text } from './nodes.ts';

test('ProjectedAnchor centers horizontally and can end-align vertically', () => {
  const node = ProjectedAnchor(
    { col: 10, row: 8, width: 5, height: 2, alignY: 'end' },
    [Text({ text: 'x' })],
  );
  assert.equal(node.style.position, 'absolute');
  assert.equal(node.style.left, 8);
  assert.equal(node.style.top, 7);
  assert.equal(node.style.width, 5);
  assert.equal(node.style.height, 2);
  assert.equal(node.overlay, undefined);
});

test('ProjectedAnchor preserves presentation style without allowing it to move the anchor', () => {
  const node = ProjectedAnchor({
    col: 4,
    row: 3,
    width: 2,
    alignX: 'start',
    style: { left: 99, background: [1, 2, 3] },
  });
  assert.equal(node.style.left, 4);
  assert.deepEqual(node.style.background, [1, 2, 3]);
});
