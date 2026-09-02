import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { RenderTarget } from '../../../engine/index.ts';
import { ShapeGlyphSurfaceCache, shapeGlyphToSurface } from '../../../engine/present-cells.ts';
import { Surface } from '../../../engine/surface.ts';
import { TileScene, type IslandersMode } from './tile-scene.ts';

function frameHash(target: RenderTarget): string {
  return createHash('sha256')
    .update(Buffer.from(target.color.buffer))
    .update(Buffer.from(target.depth.buffer))
    .digest('hex');
}

test('authored Islanders traversal preserves every showcase framebuffer baseline', () => {
  const cases: { mode: IslandersMode; configure(scene: TileScene): void; expected: string }[] = [
    { mode: 'tile', configure: () => {}, expected: 'c0548aa8bb4493d2f588172ae8665ae66d9a11535e55100c60f74038f2eb4e7b' },
    { mode: 'board', configure: (scene) => scene.seedDemo(), expected: '70cee2d1f06e6b7881659f349c7b78cc1d23f96caf51fdb29b8304a900d6115d' },
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

test('authored Islanders traversal preserves the staged island-build animation', () => {
  const frames = [
    { time: 0, expected: '45c58577d8e053c6a1bd656a0b9f40a9b0fa868687c5a3608a3dc1640651abe1' },
    { time: 1.5, expected: '61b5c3e6c42c9649f88c58d33e8686a54add78facf294a3385339aea7091e062' },
    { time: 3.1, expected: '7dd3606d692b7ca07c20c80ecaa65af7cb8c2132c6205e3aef824df18f88a3c5' },
    { time: 3.7, expected: '45e35776b42f91aeaf8b980664ca96c62e8f4b158199129078b3a33e365143a1' },
    { time: 4.4, expected: 'd429b50da75b9f96e3943155705d06bf7523a405bf49354ca40b3039214640d4' },
    { time: 5.3, expected: '1cff47b58f939fdc7b22ef1d31098a51b53d8d83d8024822950f10e7caae1bcb' },
  ];
  const scene = new TileScene();
  scene.setMode('board');
  for (const frame of frames) {
    const target = new RenderTarget(96, 64);
    scene.renderScene(target, frame.time);
    assert.equal(frameHash(target), frame.expected, `t=${frame.time}`);
  }
});

test('large Islanders water layer remains attached across repeated renders', () => {
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

test('cached Islanders island invalidates for camera movement and target resizing', () => {
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

test('cached Islanders island invalidates when the baked robber moves', () => {
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

test('optimized settled Islanders bounds include the complete board, not only animated tiles', () => {
  const scene = settledBoard();
  const cols = 320, rows = 90;
  const target = new RenderTarget(cols * 3, rows * 6);
  scene.renderScene(target, 0.7);
  const bounded = new Surface(cols, rows);
  const complete = new Surface(cols, rows);
  shapeGlyphToSurface(bounded, target, cols, rows, { blankOutsideDepthBounds: true }, 0, 0, new ShapeGlyphSurfaceCache());
  shapeGlyphToSurface(complete, target, cols, rows, {}, 0, 0, new ShapeGlyphSurfaceCache());
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    assert.deepEqual(bounded.getCell(x, y), complete.getCell(x, y), `optimized bounds clipped cell ${x},${y}`);
  }
});
