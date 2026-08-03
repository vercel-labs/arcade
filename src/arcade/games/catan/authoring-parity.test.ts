import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { RenderTarget } from '../../../engine/index.ts';
import { TileScene, type CatanMode } from './tile-scene.ts';

function frameHash(target: RenderTarget): string {
  return createHash('sha256')
    .update(Buffer.from(target.color.buffer))
    .update(Buffer.from(target.depth.buffer))
    .digest('hex');
}

test('authored Catan traversal preserves every showcase framebuffer baseline', () => {
  const cases: { mode: CatanMode; configure(scene: TileScene): void; expected: string }[] = [
    { mode: 'tile', configure: () => {}, expected: '5d70d98a36ab978fc06842cdb4a54246a955ce706dede688f681507bcfed0b8a' },
    { mode: 'board', configure: (scene) => scene.seedDemo(), expected: 'a292ed1830e1e567e20b52329e0e2716230b8a814e9d83200fe1eaeb04556bc3' },
    { mode: 'pieces', configure: (scene) => scene.setActiveColor('blue'), expected: '90f3e00c4d450b93e973419fa964f0eba20af70bc6b38adc554133b62854537e' },
    { mode: 'port', configure: (scene) => scene.setPortKind('ore'), expected: '13883082470bd0d26188b9932369649d30a178fd53463d0f3bc235b7fdb576ed' },
  ];
  for (const entry of cases) {
    const scene = new TileScene();
    scene.setMode(entry.mode);
    entry.configure(scene);
    if (entry.mode === 'board') scene.settle();
    const target = new RenderTarget(96, 64);
    scene.renderScene(target, 0.7);
    assert.equal(frameHash(target), entry.expected, entry.mode);
  }
});
