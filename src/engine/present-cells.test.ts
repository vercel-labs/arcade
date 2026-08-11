import assert from 'node:assert/strict';
import test from 'node:test';
import { RenderTarget } from './framebuffer.ts';
import { halfBlockLayerToSurface, shapeGlyphLayerToSurface } from './present-cells.ts';
import { Surface } from './surface.ts';

test('shape glyph foreground layer leaves untouched cells transparent', () => {
  const target = new RenderTarget(16, 16);
  target.clear();
  // A bright left half with finite depth; the right half remains untouched/infinite.
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 8; x++) target.plot(x, y, 0.2, { r: 240, g: 220, b: 180, a: 1 }, 'opaque');
  }
  const surface = new Surface(2, 1);
  surface.drawText(0, 0, 'UI', [255, 255, 255], [10, 20, 30]);

  shapeGlyphLayerToSurface(surface, target, 2, 1);

  assert.notEqual(surface.getCell(0, 0)?.ch, 'U', 'covered cell receives the foreground glyph');
  assert.equal(surface.getCell(1, 0)?.ch, 'I', 'uncovered cell preserves existing UI');
  assert.deepEqual(surface.getCell(0, 0)?.bg, [10, 20, 30], 'foreground glyph preserves the existing cell background');
});

test('half-block foreground layer replaces covered cells and preserves untouched UI', () => {
  const target = new RenderTarget(2, 2);
  target.clear();
  target.plot(0, 0, 0.1, { r: 250, g: 240, b: 230, a: 1 }, 'opaque');
  const surface = new Surface(2, 1);
  surface.drawText(0, 0, 'UI', [255, 255, 255], [10, 20, 30]);

  halfBlockLayerToSurface(surface, target);

  assert.equal(surface.getCell(0, 0)?.ch, '▀');
  assert.equal(surface.getCell(1, 0)?.ch, 'I');
});
