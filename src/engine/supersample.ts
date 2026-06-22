import { RenderTarget } from './framebuffer.ts';

// sRGB ⇄ linear (gamma ≈ 2.2). Values are 0..255 floats but may exceed 255 from
// additive blending; the power curve handles >1 fine and round-trips it back.
const GAMMA = 2.2;
const toLinear = (v: number): number => Math.pow(v / 255, GAMMA);
const toSrgb = (v: number): number => Math.pow(v, 1 / GAMMA) * 255;

// Box-downsamples a high-resolution render target by an integer factor — SSAA.
// Averages IN LINEAR LIGHT (decode sRGB → average → re-encode): averaging in
// gamma space darkens partial-coverage edges and muddies smooth gradients,
// while linear averaging keeps them clean. Pass a reusable `out` to avoid
// per-frame allocation.
export function downsample(src: RenderTarget, factor: number, out?: RenderTarget): RenderTarget {
  if (factor <= 1) return src;
  const W = Math.floor(src.width / factor);
  const H = Math.floor(src.height / factor);
  const dst = out && out.width === W && out.height === H ? out : new RenderTarget(W, H);
  const sc = src.color;
  const dc = dst.color;
  const sw = src.width;
  const inv = 1 / (factor * factor);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = 0; dy < factor; dy++) {
        const row = (y * factor + dy) * sw;
        for (let dx = 0; dx < factor; dx++) {
          const si = (row + x * factor + dx) * 3;
          r += toLinear(sc[si]);
          g += toLinear(sc[si + 1]);
          b += toLinear(sc[si + 2]);
        }
      }
      const di = (y * W + x) * 3;
      dc[di] = toSrgb(r * inv);
      dc[di + 1] = toSrgb(g * inv);
      dc[di + 2] = toSrgb(b * inv);
    }
  }
  return dst;
}
