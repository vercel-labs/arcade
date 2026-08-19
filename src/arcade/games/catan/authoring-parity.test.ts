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
    { mode: 'board', configure: (scene) => scene.seedDemo(), expected: '6c10168cfcab6e550ce1492c316dfe1bd55195e8c4318552960725ae3faad610' },
    { mode: 'pieces', configure: (scene) => scene.setActiveColor('blue'), expected: '2446ef4446021cbb402048154da0846bca91ad2f0a230d7806851814cdcc7ee3' },
    { mode: 'port', configure: (scene) => scene.setPortKind('ore'), expected: 'e13e798a204d243ff546b218e1ec564f67e81a08bd7108fb910f78ba24719c0b' },
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
    { time: 4.4, expected: '4f8b375d6870ef50ad8f4040c9e066242d827f532a8d7cc457c7d4d6079a9ff3' },
    { time: 5.3, expected: 'f9e590ab4fcd08ec59e18b3129bb82a8fb1bc85b9cee1cd0563e5800ffd2a5d4' },
  ];
  const scene = new TileScene();
  scene.setMode('board');
  for (const frame of frames) {
    const target = new RenderTarget(96, 64);
    scene.renderScene(target, frame.time);
    assert.equal(frameHash(target), frame.expected, `t=${frame.time}`);
  }
});

test('large Catan water layer remains attached across repeated renders', () => {
  const scene = new TileScene();
  scene.setMode('board');
  scene.seedDemo();
  scene.settle();
  const first = new RenderTarget(180, 120);
  const second = new RenderTarget(180, 120);
  scene.renderScene(first, 0.7);
  scene.renderScene(second, 0.7);
  assert.equal(frameHash(second), frameHash(first));
});

function settledBoard(): TileScene {
  const scene = new TileScene();
  scene.setMode('board');
  scene.seedDemo();
  scene.settle();
  return scene;
}

test('cached Catan island invalidates for camera movement and target resizing', () => {
  const cached = settledBoard();
  cached.renderScene(new RenderTarget(180, 120), 0.7); // populate the original cache
  cached.orbit(7, -3);
  cached.renderScene(new RenderTarget(180, 120), 0.8); // rebuild for the camera
  const resized = new RenderTarget(240, 160);
  cached.renderScene(resized, 0.9); // rebuild for the target size

  const fresh = settledBoard();
  fresh.orbit(7, -3);
  const expected = new RenderTarget(240, 160);
  fresh.renderScene(expected, 0.9);
  assert.equal(frameHash(resized), frameHash(expected));
});

test('cached Catan island invalidates when the baked robber moves', () => {
  const cached = settledBoard();
  cached.renderScene(new RenderTarget(180, 120), 0.7);
  const destination = (cached.currentRobberHex() + 1) % 19;
  cached.syncRobberHex(destination);
  const moved = new RenderTarget(180, 120);
  cached.renderScene(moved, 0.8);

  const fresh = settledBoard();
  fresh.syncRobberHex(destination);
  const expected = new RenderTarget(180, 120);
  fresh.renderScene(expected, 0.8);
  assert.equal(frameHash(moved), frameHash(expected));
});

test('high-resolution camera interaction resolves to a crisp full frame on release', () => {
  const scene = settledBoard();
  scene.setCameraInteracting(true);
  scene.orbit(7, -3);
  const moving = new RenderTarget(780, 480);
  scene.renderScene(moving, 0.7);

  scene.setCameraInteracting(false);
  const released = new RenderTarget(780, 480);
  scene.renderScene(released, 0.8);

  const fresh = settledBoard();
  fresh.orbit(7, -3);
  const expected = new RenderTarget(780, 480);
  fresh.renderScene(expected, 0.8);
  assert.notEqual(frameHash(moving), frameHash(released), 'drag frame should use temporary dynamic resolution');
  assert.equal(frameHash(released), frameHash(expected));
});
