import type { RenderTarget } from './framebuffer.ts';

export interface BloomOptions {
  threshold?: number; // luminance (0..255) above which a pixel blooms
  intensity?: number; // how strongly the blurred bright pass is added back
  radius?: number; // blur radius in pixels
  passes?: number; // repeated blur passes (more = softer, wider)
}

// Extracts bright pixels, blurs them, and adds the blur back — the glow that
// makes the beam, rainbow, and glass edges read as emitted light. Operates in
// place on the target's color buffer.
export function bloom(target: RenderTarget, options: BloomOptions = {}): void {
  const { threshold = 70, intensity = 0.7, radius = 2, passes = 2 } = options;
  const W = target.width;
  const H = target.height;
  const n = W * H * 3;
  const c = target.color;

  const bright = new Float32Array(n);
  for (let i = 0; i < n; i += 3) {
    const lum = (c[i] + c[i + 1] + c[i + 2]) / 3;
    if (lum > threshold) {
      bright[i] = c[i];
      bright[i + 1] = c[i + 1];
      bright[i + 2] = c[i + 2];
    }
  }

  const tmp = new Float32Array(n);
  for (let p = 0; p < passes; p++) {
    boxBlurH(bright, tmp, W, H, radius);
    boxBlurV(tmp, bright, W, H, radius);
  }

  for (let i = 0; i < n; i++) c[i] += bright[i] * intensity;
}

function boxBlurH(src: Float32Array, dst: Float32Array, W: number, H: number, r: number): void {
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      let sr = 0;
      let sg = 0;
      let sb = 0;
      for (let dx = -r; dx <= r; dx++) {
        const xx = Math.min(W - 1, Math.max(0, x + dx));
        const si = (row + xx) * 3;
        sr += src[si];
        sg += src[si + 1];
        sb += src[si + 2];
      }
      const di = (row + x) * 3;
      dst[di] = sr * inv;
      dst[di + 1] = sg * inv;
      dst[di + 2] = sb * inv;
    }
  }
}

function boxBlurV(src: Float32Array, dst: Float32Array, W: number, H: number, r: number): void {
  const inv = 1 / (2 * r + 1);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      let sr = 0;
      let sg = 0;
      let sb = 0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = Math.min(H - 1, Math.max(0, y + dy));
        const si = (yy * W + x) * 3;
        sr += src[si];
        sg += src[si + 1];
        sb += src[si + 2];
      }
      const di = (y * W + x) * 3;
      dst[di] = sr * inv;
      dst[di + 1] = sg * inv;
      dst[di + 2] = sb * inv;
    }
  }
}
