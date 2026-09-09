import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { RenderTarget } from '../../../engine/index.ts';
import { assertFrameSignature } from '../frame-signature.ts';
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
    { mode: 'tile', configure: () => {}, expected: 'DhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWEBQYDxIXDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWEhUZJ0YvMFE4MFk4JDkqHy8lDhAWDhAWDhAWDhAWDhAWFRwcS3RLNmI8SndPVHJNOGlBOmtDERUZDhAWDhAWDhAWDhAWPUk4RHRLO2pCOWtDUG5ISntOU4JYNjowDhAWDhAWDhAWDhAWUko5f4piUH5WUYNYVYNXW4lcdIpgWVRBDhAWDhAWDhAWDhAWDhAWMColgHVUfZBnhIdgfW1PQjkuFxcaDhAWDhAWDhAWDhAWDhAWDhAWExQYQzouKCQiDhAWDhAWDhAWDhAWDhAW' },
    { mode: 'board', configure: (scene) => scene.seedDemo(), expected: 'DhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWEBMZIDA5MTU3Gi04IyovDhEXDhAWDhAWDhAWDhAWDhAWEBslXGdRl3s/fGVAmItVnZxXOVVbFxkeDhAWDhAWDhAWFyMtfHxkoI1bYX5Tb490eJhwa5Flgp53NlFXDhEYDhAWDhAWERwmUnBzk5OWoHRYrX1Gwa5FaIRXc4pgWG1uEBkiDhAWDhAWDhAWRlxjlZCGjouLj5GbvKdXuadFYnxyFzlMDhAWDhAWDhAWDhAWHUVaX3Z0enpsf4V3doNssZZXQ2x7DxUdDhAWDhAWDhAWDhAWEBggEiMvFS08FjNDFzlLI0RVGC88DhAWDhAWDhAW' },
    { mode: 'pieces', configure: (scene) => scene.setActiveColor('blue'), expected: 'DhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWEBUfEBUfFyM8ERYiFyM8ExssDhAWDhAWDhAWDhAWDhAWDhAWDxIaFSE3HjNdHTFZLFOcGCZBDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWEhoqDxIaDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAW' },
    { mode: 'port', configure: (scene) => scene.setPortKind('ore'), expected: 'DhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWMzE0aWZkGhsgDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWkpGQ0c/KIiQpDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWd29ro5SKGRkdDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWMiYigF1KcWpqQzEpEBEXDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWLiMgTTQqOyslDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAW' },
  ];
  for (const entry of cases) {
    const scene = new TileScene();
    scene.setMode(entry.mode);
    entry.configure(scene);
    if (entry.mode === 'board') scene.settle();
    const target = new RenderTarget(96, 64);
    scene.renderScene(target, 0.7);
    assertFrameSignature(target, entry.expected, entry.mode);
  }
});

test('authored Islanders traversal preserves the staged island-build animation', () => {
  const frames = [
    { time: 0, expected: 'DhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhEXFC8/Eys6Eyw6ESMvDhEXDhAWDhAWDhAWfGZIExQYEBslG01mH117HVl2GlVyHFl3F0FXDhEYDhAWDhAWfmhIMjo5GlJuHFVyG1NwHFVxHVh1Hlp3H1x5GERaDhEYDhAWOjMqFyIpHVd0Hlh1HFVyHll1HVh1H116IF57HVh0EBkiDhAWDhAWDhAWHVRvIV56IFt4HVd0IFx4I2F+H1x6FzlMDhAWDhAWDhAWDhAWGURbH1l2IFt4H1p2IFx5JWOAJGB7DxUdDhAWDhAWDhAWDhAWDxcfEiMvFS07FTJDGDlMGkJXFi48DhAWDhAWDhAW' },
    { time: 1.5, expected: 'DhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhEXIDhAHzI4RkInESIuDhEXDhAWDhAWDhAWJSIhIR8fKi4uG05mbZuCkZlqmptbJF93F0FXDhEYDhAWDhAWk3lUQkdCKFVpJ1hsV31afJVsdJpvQHBhHlx5GERbDhEYDhAWOjMqFyIpHVh0Hlh1f2JOrXxFwK1EQ25vH117HFh0EBkiDhAWDhAWDhAWHVVwIV16J1tzJVlyQmluJWJ+H116FzlMDhAWDhAWDhAWDhAWGURaH1p2IFx4H1p2IV16JWSAJmF8DxUdDhAWDhAWDhAWDhAWEBggEiIuFS08FzREFzhLG0NXFi48DhAWDhAWDhAW' },
    { time: 3.1, expected: 'DhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhEYHS04Giw4Fyw5ESIuDhEYDhAWDhAWDhAWDhAWDhAWEBslR2JXkHpDe2hDmItWkJZZKU1aDhEYDhAWDhAWDhAWESEsTmhmoI1bYX9QfJhudptxapBlcph8Jk9fDhEXDhAWDhAWER0mMWB1kpKVoHRYrX1HwK1EaIRXXn9gKl90EBkiDhAWDhAWDhAWHVRwfoWHjouLj5GbvKdXt6ZDPm11FzlMDhAWDhAWDhAWDhAWGUNZNmR2N2Z3U3N8U3RveoZlJGF8DxUcDhAWDhAWDhAWDhAWEBggEiIuFS07FzRFGDpNGkNXFy89DhAWDhAWDhAW' },
    { time: 3.7, expected: 'DhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhEYIC84NDs+Gi45FiQtDhEYDhAWDhAWDhAWDhAWDhAWER0nVWtbkntDfGlDmYxVmppYMlFaDhEYDhAWDhAWDhAWESEsaXVmoY5aYX9QepZsdJlvapBle5x7NFVdDhEXDhAWDhAWER0nT3J5k5OWoHRYrH1GwK1EaIRXcophOmZyEBkiDhAWDhAWDhAWJVdvl5KJjouLj5GbvKdXtqVEYntxFzlMDhAWDhAWDhAWDhAWHENYX3Z0WXV1e4R5d4NspJdgNWl9DxUcDhAWDhAWDhAWDhAWEBggEiIuFS07FzRFGDtNG0NYFy89DhAWDhAWDhAW' },
    { time: 4.4, expected: 'DhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhEYIC84MDQ3Gi45FiQuDhEYDhAWDhAWDhAWDhAWDhAWERwmXGVPk3tCe2hDmYxVnJ1aQllcERQaDhAWDhAWDhAWHSYudHdioY5aYX9QeJRqdptwapBle5x7NFVdDhIZDhAWDhAWER0nUm9yk5OWoHRYrX1HwK1EaIRXcYhfU21wEBkiDhAWDhAWDhAWP15rlZGKjouLj5GbvKdXuadFXntyFjlLDhAWDhAWDhAWDhAWG0JWYHd1cHxzh4Z2d4Ntp5deVW1zDxUcDhAWDhAWDhAWDhAWEBggEiIuGC47GjRDGDtOHERYFi49DhAWDhAWDhAW' },
    { time: 5.3, expected: 'DhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWDhAWEBMaIC43Mzc4Gi46IykuDhEYDhAWDhAWDhAWDhAWDhAWEBwmWmdSlXpAe2hDmIxVnZtXN1NZFxkeDhAWDhAWDhAWFyMsfHpioY5aYX9Qe5dtd51yaI1jgZx2N1RbDxMaDhAWDhAWER0nUW9yk5OWoHRYrX1HwK1EaIRXcIdfWG1uEBkiDhAWDhAWDhAWRl1jlZCGjouLj5GbvKdXtqVEX3x0FjlLDhAWDhAWDhAWDhAWHEJWX3Z0d3ltf4R2eIRtsZZXQW18DxUcDhAWDhAWDhAWDhAWDxcgEiMvFi08FzVFGDtOJEVVGC88DhAWDhAWDhAW' },
  ];
  const scene = new TileScene();
  scene.setMode('board');
  for (const frame of frames) {
    const target = new RenderTarget(96, 64);
    scene.renderScene(target, frame.time);
    assertFrameSignature(target, frame.expected, `t=${frame.time}`);
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
