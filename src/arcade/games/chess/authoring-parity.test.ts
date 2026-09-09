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

// These baselines are sha256 over the raw float32 color and depth buffers, captured on
// one machine. Transcendental math and FMA contraction differ across CPU architectures,
// so any case that accumulates float error (settle loops, animation integration) diverges
// in the last ULP on a different host: identical picture, different bytes. Keep them as a
// local regression guard, matching how AGENTS.md treats `islanders:check` baselines, and
// skip in CI rather than pretending a byte baseline is portable.
const MACHINE_BASELINE = {
  skip: process.env.CI ? 'framebuffer byte baselines are machine-specific' : false,
};

test('authored Chess traversal preserves direct-raster framebuffer baselines', MACHINE_BASELINE, () => {
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
