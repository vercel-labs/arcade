// A rendered-frame fingerprint that survives a change of CPU architecture.
//
// Hashing the raw float32 color and depth buffers does not. Transcendental math and FMA
// contraction differ between arm64 and x64, so a scene that draws an identical picture
// still produces different bytes once error accumulates through a settle loop or an
// animation integrator: the same image, a different sha256.
//
// Averaging into coarse tiles washes that out. The per-pixel divergence is around 1e-7,
// far under the 1/255 quantisation step, and averaging over a tile shrinks it further.
// Comparison then allows one step of slack so a tile average that happens to sit on a
// rounding boundary cannot flake either.
//
// Color only, deliberately. Depth accumulates the same error but is not what the frame
// looks like, and the depth-sensitive behaviour (cache invalidation, bounds, attachment)
// is asserted directly by the neighbouring tests rather than through a golden value.
import assert from 'node:assert/strict';
import type { RenderTarget } from '../../engine/index.ts';

const TILE_COLS = 12;
const TILE_ROWS = 8;
/** Slack per tile channel, in quantisation steps. */
const TOLERANCE = 1;

// The framebuffer already carries 0..255 channel intensities as floats, and can exceed
// 255 before tone mapping, so clamp rather than rescale.
const quantise = (v: number): number => (Number.isFinite(v) ? Math.max(0, Math.min(255, Math.round(v))) : 0);

/** Average each tile's RGB into a byte, as base64. Stable across architectures. */
export function frameSignature(target: RenderTarget): string {
  const { width, height, color } = target;
  const out = new Uint8Array(TILE_COLS * TILE_ROWS * 3);
  for (let ty = 0; ty < TILE_ROWS; ty++) {
    const y0 = Math.floor((ty * height) / TILE_ROWS);
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * height) / TILE_ROWS));
    for (let tx = 0; tx < TILE_COLS; tx++) {
      const x0 = Math.floor((tx * width) / TILE_COLS);
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * width) / TILE_COLS));
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 3;
          r += color[i]; g += color[i + 1]; b += color[i + 2];
          n++;
        }
      }
      const at = (ty * TILE_COLS + tx) * 3;
      out[at] = quantise(r / n);
      out[at + 1] = quantise(g / n);
      out[at + 2] = quantise(b / n);
    }
  }
  return Buffer.from(out).toString('base64');
}

/**
 * Compare a frame against its baseline. Reports the worst tile deviation and the actual
 * signature on failure, so a real visual change is easy to tell from noise and the new
 * baseline can be copied straight out of the message.
 */
export function assertFrameSignature(target: RenderTarget, expected: string, label: string): void {
  const actual = frameSignature(target);
  const a = Buffer.from(actual, 'base64');
  const b = Buffer.from(expected, 'base64');
  assert.equal(a.length, b.length, `${label}: signature length changed`);
  let worst = 0;
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
  assert.ok(
    worst <= TOLERANCE,
    `${label}: frame differs from its baseline by ${worst} of 255 (allowed ${TOLERANCE}).\n  actual: ${actual}`,
  );
}
