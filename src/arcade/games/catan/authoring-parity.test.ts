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
    { mode: 'tile', configure: () => {}, expected: 'c0548aa8bb4493d2f588172ae8665ae66d9a11535e55100c60f74038f2eb4e7b' },
    { mode: 'board', configure: (scene) => scene.seedDemo(), expected: 'cc0fe703f3c6fb04b12bdce7deabd50a9cfa8dafec9f5ea88b2320a2bb233580' },
    { mode: 'pieces', configure: (scene) => scene.setActiveColor('blue'), expected: '60d15ad9098fc9317b5c12dd0103641a89989e7fe8a49f06e59bddc1f8fa1c0d' },
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

test('authored Catan traversal preserves the staged island-build animation', () => {
  const frames = [
    { time: 0, expected: '45c58577d8e053c6a1bd656a0b9f40a9b0fa868687c5a3608a3dc1640651abe1' },
    { time: 1.5, expected: '354ee4e4007f09af1db2443b4acd32e0c2bcb3544078e93f562281e880c922b9' },
    { time: 3.1, expected: 'a3ec8b4bab2d4b006b247430f3bb1b3447151153af6421fd7d6ea7aec17bf36b' },
    { time: 3.7, expected: '1d72a8e99edb53ed4a69080fbdb5343dfb6807157b0e518ec8fbbc28b0a09b44' },
    { time: 4.4, expected: 'c807cffec85c256893a4bd93bc43c237f25cff751c2bbe05b3451354b0ace771' },
    { time: 5.3, expected: '3fa49e9e46f15ddca0ea38bde1b76881b083568e468286309a345e870e72ce92' },
  ];
  const scene = new TileScene();
  scene.setMode('board');
  for (const frame of frames) {
    const target = new RenderTarget(96, 64);
    scene.renderScene(target, frame.time);
    assert.equal(frameHash(target), frame.expected, `t=${frame.time}`);
  }
});
