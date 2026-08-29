import type { RGBA } from './color.ts';

/** Browser-safe RGBA8 image data. PNG encoding and decoding remain Node-only. */
export interface Texture {
  width: number;
  height: number;
  data: Uint8Array;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

// Bilinearly sample a texture at uv in [0,1] (clamped at the edges). Returns the
// engine's RGBA convention: rgb 0..255, alpha 0..1. The reused tuple avoids a
// per-fragment allocation; callers consume it synchronously.
const SAMPLE: RGBA = [0, 0, 0, 0];
export function sampleTexture(tex: Texture, u: number, v: number): RGBA {
  const { width: W, height: H, data: d } = tex;
  const fx = clamp01(u) * (W - 1);
  const fy = clamp01(v) * (H - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(W - 1, x0 + 1);
  const y1 = Math.min(H - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const i00 = (y0 * W + x0) * 4;
  const i10 = (y0 * W + x1) * 4;
  const i01 = (y1 * W + x0) * 4;
  const i11 = (y1 * W + x1) * 4;
  for (let k = 0; k < 4; k++) {
    const top = d[i00 + k] + (d[i10 + k] - d[i00 + k]) * tx;
    const bot = d[i01 + k] + (d[i11 + k] - d[i01 + k]) * tx;
    SAMPLE[k] = top + (bot - top) * ty;
  }
  SAMPLE[3] /= 255;
  return SAMPLE;
}
