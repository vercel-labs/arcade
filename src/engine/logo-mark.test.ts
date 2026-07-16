import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeLogo, bakeMarkAlpha, markCoverage } from './logo-mark.ts';
import type { Texture } from './texture.ts';

// Build a WxH RGBA texture from a per-pixel painter — a compact way to construct
// the representative logo classes (cut-out / dark tile / light multi-color) as
// synthetic fixtures, so the engine primitive is tested without any brand assets.
function make(w: number, h: number, paint: (x: number, y: number) => [number, number, number, number]): Texture {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = paint(x, y);
      const o = (y * w + x) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = a;
    }
  }
  return { width: w, height: h, data };
}

const S = 32;
const inCenter = (x: number, y: number): boolean => x >= 10 && x < 22 && y >= 10 && y < 22;

test('cut-out logo: masks by alpha, ignoring a phantom under-color (ByteDance class)', () => {
  // Transparent everywhere except an opaque center — and the transparent texels
  // carry a nonzero RGB (as real cut-out PNGs do), the SAME color as the mark.
  // The old color-distance mask sampled that phantom color and eroded the mark;
  // an alpha-driven mask must keep the whole opaque region regardless.
  const phantom: [number, number, number, number] = [70, 110, 75, 0];
  const tex = make(S, S, (x, y) => (inCenter(x, y) ? [70, 110, 75, 255] : phantom));
  const a = analyzeLogo(tex);
  assert.equal(a.hasAlpha, true, 'a mostly-transparent logo is a cut-out');

  const cov = markCoverage(tex, a);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const c = cov[y * S + x];
      if (inCenter(x, y)) assert.ok(c > 0.99, `opaque mark texel should be full coverage, got ${c}`);
      else assert.ok(c < 0.01, `transparent texel should be zero coverage, got ${c}`);
    }
  }
});

test('opaque dark tile: mark is what differs from the solid background', () => {
  const tex = make(S, S, (x, y) => (inCenter(x, y) ? [255, 255, 255, 255] : [0, 0, 0, 255]));
  const a = analyzeLogo(tex);
  assert.equal(a.hasAlpha, false);
  assert.ok(a.bg.x < 8 && a.bg.y < 8 && a.bg.z < 8, `bg should read black, got ${JSON.stringify(a.bg)}`);
  const cov = markCoverage(tex, a);
  assert.ok(cov[16 * S + 16] > 0.99, 'white-on-black center is full coverage');
  assert.ok(cov[0] < 0.01, 'black corner is background');
});

test('opaque light multi-color tile: a pale lobe near the bg still survives (Cohere class)', () => {
  // Light grey tile with two mark regions: a bold dark-green blob and a PALE
  // lavender blob whose color sits only ~0.25 from the background — exactly the
  // region the old edge0=0.22 ramp faded out.
  const bg: [number, number, number, number] = [242, 242, 242, 255];
  const green: [number, number, number, number] = [53, 85, 74, 255];
  const lavender: [number, number, number, number] = [200, 140, 210, 255];
  const tex = make(S, S, (x, y) => {
    if (y >= 8 && y < 16 && x >= 8 && x < 24) return green;
    if (y >= 18 && y < 26 && x >= 8 && x < 24) return lavender;
    return bg;
  });
  const a = analyzeLogo(tex);
  assert.equal(a.hasAlpha, false);
  const cov = markCoverage(tex, a);
  assert.ok(cov[11 * S + 12] > 0.99, 'dark-green lobe is full coverage');
  assert.ok(cov[21 * S + 12] > 0.99, 'pale lavender lobe must NOT fade out');
  assert.ok(cov[2] < 0.01, 'light-grey background stays masked off');
});

test('near-background color stays masked (no leakage below the floor)', () => {
  // A region only marginally off the background should not register as mark.
  const tex = make(S, S, (x, y) => (inCenter(x, y) ? [8, 8, 8, 255] : [0, 0, 0, 255]));
  const cov = markCoverage(tex);
  assert.ok(cov[16 * S + 16] < 0.05, 'a near-black region on black is not a mark');
});

test('bakeMarkAlpha writes coverage into alpha and preserves rgb', () => {
  const tex = make(S, S, (x, y) => (inCenter(x, y) ? [255, 128, 0, 255] : [0, 0, 0, 255]));
  const same = bakeMarkAlpha(tex);
  assert.equal(same, tex, 'returns the same texture for chaining');
  const c = (16 * S + 16) * 4;
  assert.equal(tex.data[c + 3], 255, 'mark texel alpha := full coverage');
  assert.deepEqual([tex.data[c], tex.data[c + 1], tex.data[c + 2]], [255, 128, 0], 'rgb untouched for tint derivation');
  assert.equal(tex.data[3], 0, 'background texel alpha := zero coverage');
});
