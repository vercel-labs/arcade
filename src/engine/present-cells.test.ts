import assert from 'node:assert/strict';
import test from 'node:test';
import { RenderTarget } from './framebuffer.ts';
import { halfBlockLayerToSurface, ShapeGlyphSurfaceCache, shapeGlyphLayerToSurface, shapeGlyphToSurface } from './present-cells.ts';
import { toShapeGlyph } from './present.ts';
import { Surface } from './surface.ts';

function solidTarget(width: number, height: number, color: { r: number; g: number; b: number }): RenderTarget {
  const target = new RenderTarget(width, height);
  target.clear();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) target.plot(x, y, 0.2, { ...color, a: 1 }, 'opaque');
  }
  return target;
}

test('colored shape-glyph backgrounds preserve ASCII output and darken only painted cells', () => {
  const target = solidTarget(16, 16, { r: 240, g: 120, b: 60 });
  const ascii = new Surface(1, 1);
  const hybrid = new Surface(1, 1);

  shapeGlyphToSurface(ascii, target, 1, 1);
  shapeGlyphToSurface(hybrid, target, 1, 1, { coloredBackground: true });

  assert.notEqual(ascii.getCell(0, 0)?.ch, ' ');
  assert.equal(hybrid.getCell(0, 0)?.ch, ascii.getCell(0, 0)?.ch, 'hybrid keeps the exact ASCII glyph');
  assert.deepEqual(hybrid.getCell(0, 0)?.fg, ascii.getCell(0, 0)?.fg, 'hybrid keeps the exact foreground color');
  assert.deepEqual(hybrid.getCell(0, 0)?.bg, [64, 32, 16], 'hybrid adds a darker quantized version of the scene color');

  const empty = new RenderTarget(16, 16);
  empty.clear();
  const black = new Surface(1, 1);
  shapeGlyphToSurface(black, empty, 1, 1, { coloredBackground: true });
  assert.equal(black.getCell(0, 0)?.ch, ' ');
  assert.deepEqual(black.getCell(0, 0)?.bg, [0, 0, 0], 'blank scene cells stay black');
});

test('ANSI shape-glyph output resets the colored background for blank cells', () => {
  const target = new RenderTarget(32, 16);
  target.clear();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) target.plot(x, y, 0.2, { r: 240, g: 120, b: 60, a: 1 }, 'opaque');
  }

  const output = toShapeGlyph(target, 2, 1, { coloredBackground: true });

  assert.match(output, /;48;2;64;32;16m/);
  assert.ok(output.includes('\x1b[48;2;0;0;0m'), 'blank cells explicitly restore the black backdrop');
});

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

test('shape glyph foreground layer can paint its dimmed scene background', () => {
  const target = solidTarget(16, 16, { r: 200, g: 100, b: 50 });
  const surface = new Surface(1, 1);
  surface.drawText(0, 0, 'U', [255, 255, 255], [10, 20, 30]);

  shapeGlyphLayerToSurface(surface, target, 1, 1, { coloredBackground: true });

  assert.deepEqual(surface.getCell(0, 0)?.bg, [56, 32, 16]);
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

test('native 3x6 shape-glyph fast path matches the generic resampler exactly', () => {
  const cols = 5;
  const rows = 4;
  const target = new RenderTarget(cols * 3, rows * 6);
  target.clear();
  for (let y = 0; y < target.height; y++) {
    for (let x = 0; x < target.width; x++) {
      target.plot(x, y, 0.2, {
        r: (x * 43 + y * 17) % 256,
        g: (x * 11 + y * 61) % 256,
        b: (x * 29 + y * 7) % 256,
        a: 1,
      }, 'opaque');
    }
  }

  const fast = new Surface(cols, rows);
  shapeGlyphToSurface(fast, target, cols, rows, { hybrid: true, coloredBackground: true });

  // Doubling every source sample forces the generic path while preserving the
  // exact 3x6 luminance/color values represented by each terminal cell.
  const doubled = new RenderTarget(target.width * 2, target.height * 2);
  doubled.clear();
  for (let y = 0; y < target.height; y++) {
    for (let x = 0; x < target.width; x++) {
      const i = (y * target.width + x) * 3;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          doubled.plot(x * 2 + dx, y * 2 + dy, 0.2, {
            r: target.color[i],
            g: target.color[i + 1],
            b: target.color[i + 2],
            a: 1,
          }, 'opaque');
        }
      }
    }
  }
  const generic = new Surface(cols, rows);
  shapeGlyphToSurface(generic, doubled, cols, rows, { hybrid: true, coloredBackground: true });

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) assert.deepEqual(fast.getCell(x, y), generic.getCell(x, y), `${x},${y}`);
  }
});

test('bounded shape-glyph presentation preserves a dark empty backdrop exactly', () => {
  const cols = 6;
  const rows = 4;
  const target = new RenderTarget(cols * 3, rows * 6);
  target.clear(14, 16, 22);
  for (let y = 6; y < 18; y++) {
    for (let x = 6; x < 12; x++) target.plot(x, y, 0.2, { r: 80 + x, g: 120 + y, b: 170, a: 1 }, 'opaque');
  }
  const full = new Surface(cols, rows);
  const bounded = new Surface(cols, rows);
  shapeGlyphToSurface(full, target, cols, rows, { coloredBackground: true });
  shapeGlyphToSurface(bounded, target, cols, rows, { coloredBackground: true, blankOutsideDepthBounds: true });
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) assert.deepEqual(bounded.getCell(x, y), full.getCell(x, y));
  }
});

test('retained shape-glyph cells match a fresh presentation across animated changes', () => {
  const cols = 5;
  const rows = 3;
  const target = solidTarget(cols * 3, rows * 6, { r: 90, g: 130, b: 170 });
  const cache = new ShapeGlyphSurfaceCache();
  shapeGlyphToSurface(new Surface(cols, rows), target, cols, rows, {}, 0, 0, cache);

  for (let y = 6; y < 12; y++) {
    for (let x = 6; x < 9; x++) target.plot(x, y, 0.1, { r: 220, g: 130, b: 70, a: 1 }, 'opaque');
  }
  const retained = new Surface(cols, rows);
  const fresh = new Surface(cols, rows);
  shapeGlyphToSurface(retained, target, cols, rows, {}, 0, 0, cache);
  shapeGlyphToSurface(fresh, target, cols, rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) assert.deepEqual(retained.getCell(x, y), fresh.getCell(x, y));
  }
});
test('render target resize reuses buffers at one size and reallocates only when dimensions change', () => {
  const target = new RenderTarget(8, 6), color = target.color, depth = target.depth;
  target.resize(8, 6);
  assert.equal(target.color, color); assert.equal(target.depth, depth);
  target.resize(12, 9);
  assert.equal(target.width, 12); assert.equal(target.height, 9);
  assert.notEqual(target.color, color); assert.notEqual(target.depth, depth);
});
