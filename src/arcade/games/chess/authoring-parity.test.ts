import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { RenderTarget } from '../../../engine/index.ts';
import { ChessGameScene } from './scene.ts';

function frameHash(target: RenderTarget): string {
  return createHash('sha256')
    .update(Buffer.from(target.color.buffer))
    .update(Buffer.from(target.depth.buffer))
    .digest('hex');
}

test('authored Chess traversal preserves direct-raster framebuffer baselines', () => {
  const scene = new ChessGameScene();
  const cases: { name: string; mutate(): void; expected: string }[] = [
    {
      name: 'default',
      mutate: () => {},
      expected: 'd585dca77e0aeaa0cf1e69a6beb5369a3900b07adf92f177a4d948f58ca44c69',
    },
    {
      name: 'orbit',
      mutate: () => scene.orbit(7, -3),
      expected: '5b1e123908fbf6ce34408b50a64cb6384e2e116d2ae3f0c74b4cebe63ea825b2',
    },
    {
      name: 'zoom-pan',
      mutate: () => {
        scene.zoomBy(0.82);
        scene.pan(9, -4);
      },
      expected: 'dc409c7f6d97a1194da1d51862e5cabd6aaba130b7154acf69ce3bd7989c3845',
    },
  ];
  for (const entry of cases) {
    entry.mutate();
    const target = new RenderTarget(280, 192);
    scene.renderScene(target, 0);
    assert.equal(frameHash(target), entry.expected, entry.name);
  }
});
