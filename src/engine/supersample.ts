import { RenderTarget } from './framebuffer.ts';

// Box-downsamples a high-resolution render target by an integer factor,
// averaging each factor×factor block into one output pixel. This is SSAA: edges
// rendered at higher resolution become partial-coverage blends here, removing
// the hard staircase of single-sample rasterization.
//
// Pass a reusable `out` target to avoid per-frame allocation.
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
          r += sc[si];
          g += sc[si + 1];
          b += sc[si + 2];
        }
      }
      const di = (y * W + x) * 3;
      dc[di] = r * inv;
      dc[di + 1] = g * inv;
      dc[di + 2] = b * inv;
    }
  }
  return dst;
}
