import type { BlendMode, RGBA } from './shader.ts';

// A render target in PIXEL resolution: an RGB float color buffer (values 0..255)
// plus a per-pixel depth buffer. The half-block presenter maps two pixel rows
// onto each terminal cell, so height is typically 2× the terminal row count.
export class RenderTarget {
  width: number;
  height: number;
  color: Float32Array;
  depth: Float32Array;

  constructor(width: number, height: number) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.color = new Float32Array(this.width * this.height * 3);
    this.depth = new Float32Array(this.width * this.height);
  }

  clear(r = 0, g = 0, b = 0): void {
    const c = this.color;
    for (let i = 0; i < c.length; i += 3) {
      c[i] = r;
      c[i + 1] = g;
      c[i + 2] = b;
    }
    this.depth.fill(Infinity);
  }

  // Depth-tested, blended write. Smaller depth is nearer (NDC z). Opaque writes
  // depth; add/alpha test against it (so they're occluded by nearer opaque
  // geometry) but don't write it, letting translucent layers accumulate.
  plot(x: number, y: number, z: number, c: RGBA, blend: BlendMode): void {
    const px = x | 0;
    const py = y | 0;
    if (px < 0 || px >= this.width || py < 0 || py >= this.height) return;
    const di = py * this.width + px;
    const i = di * 3;
    const col = this.color;

    if (blend === 'opaque') {
      if (z >= this.depth[di]) return;
      this.depth[di] = z;
      col[i] = c.r;
      col[i + 1] = c.g;
      col[i + 2] = c.b;
      return;
    }
    if (z > this.depth[di]) return;
    if (blend === 'add') {
      col[i] += c.r * c.a;
      col[i + 1] += c.g * c.a;
      col[i + 2] += c.b * c.a;
    } else {
      const a = c.a;
      col[i] = c.r * a + col[i] * (1 - a);
      col[i + 1] = c.g * a + col[i + 1] * (1 - a);
      col[i + 2] = c.b * a + col[i + 2] * (1 - a);
    }
  }
}
