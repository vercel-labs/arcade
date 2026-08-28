import { RenderTarget } from './framebuffer.ts';

// sRGB ⇄ linear (gamma ≈ 2.2). Values are 0..255 floats but may exceed 255 from
// additive blending; the power curve handles >1 fine and round-trips it back.
const GAMMA = 2.2;
const LINEAR_LUT_SCALE = 64;
const LINEAR_LUT_MAX = 1024;
const LINEAR_LUT = Float64Array.from(
  { length: LINEAR_LUT_MAX * LINEAR_LUT_SCALE + 1 },
  (_, i) => Math.pow(i / LINEAR_LUT_SCALE / 255, GAMMA),
);

// Downsampling calls this once per source channel—millions of times on a large terminal.
// A finely sampled 1D transfer table with linear interpolation retains sub-byte framebuffer
// precision while avoiding the much more expensive power function in the inner pixel loop.
const toLinear = (v: number): number => {
  if (v <= 0) return 0;
  const sample = v * LINEAR_LUT_SCALE;
  if (sample >= LINEAR_LUT.length - 1) return Math.pow(v / 255, GAMMA);
  const index = sample | 0;
  const mix = sample - index;
  return LINEAR_LUT[index] + (LINEAR_LUT[index + 1] - LINEAR_LUT[index]) * mix;
};
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
  const sd = src.depth;
  const dd = dst.depth;
  const sw = src.width;
  const inv = 1 / (factor * factor);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let depth = Infinity;
      for (let dy = 0; dy < factor; dy++) {
        const row = (y * factor + dy) * sw;
        for (let dx = 0; dx < factor; dx++) {
          const spi = row + x * factor + dx;
          const si = spi * 3;
          r += toLinear(sc[si]);
          g += toLinear(sc[si + 1]);
          b += toLinear(sc[si + 2]);
          if (sd[spi] < depth) depth = sd[spi];
        }
      }
      const dpi = y * W + x;
      const di = dpi * 3;
      dc[di] = toSrgb(r * inv);
      dc[di + 1] = toSrgb(g * inv);
      dc[di + 2] = toSrgb(b * inv);
      // Preserve nearest coverage as well as color. Presenters normally ignore depth, but a
      // sparse foreground layer uses finite depth as its transparency mask after downsampling.
      dd[dpi] = depth;
    }
  }
  return dst;
}
