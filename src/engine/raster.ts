import type { RenderTarget } from './framebuffer.ts';
import type { Mesh } from './mesh.ts';
import type { CullMode, Material, Varying } from './shader.ts';

// Vertices with clip-space w at or below this are behind the camera; triangles
// are clipped against this plane to avoid projecting through the singularity.
const NEAR_W = 1e-4;

interface Screen {
  sx: number;
  sy: number;
  z: number; // NDC z, for depth test
  invw: number;
  vy: Varying;
}

export function rasterize<U>(target: RenderTarget, mesh: Mesh, material: Material<U>, uniforms: U): void {
  const blend = material.blend ?? 'opaque';
  const cull = material.cull ?? 'back';
  const idx = mesh.indices;
  for (let i = 0; i < idx.length; i += 3) {
    const tri = [
      material.vertex(uniforms, mesh.vertices[idx[i]]),
      material.vertex(uniforms, mesh.vertices[idx[i + 1]]),
      material.vertex(uniforms, mesh.vertices[idx[i + 2]]),
    ];
    const poly = clipNear(tri);
    // Fan-triangulate the (possibly clipped) polygon.
    for (let k = 2; k < poly.length; k++) {
      drawTriangle(target, material, uniforms, poly[0], poly[k - 1], poly[k], blend, cull);
    }
  }
}

// Sutherland-Hodgman clip of a polygon against the near plane (clip.w > NEAR_W).
function clipNear(input: Varying[]): Varying[] {
  const out: Varying[] = [];
  for (let i = 0; i < input.length; i++) {
    const a = input[i];
    const b = input[(i + 1) % input.length];
    const aIn = a.clip.w > NEAR_W;
    const bIn = b.clip.w > NEAR_W;
    if (aIn) out.push(a);
    if (aIn !== bIn) {
      const t = (NEAR_W - a.clip.w) / (b.clip.w - a.clip.w);
      out.push(lerpVarying(a, b, t));
    }
  }
  return out;
}

function lerpVarying(a: Varying, b: Varying, t: number): Varying {
  const l = (x: number, y: number): number => x + (y - x) * t;
  return {
    clip: { x: l(a.clip.x, b.clip.x), y: l(a.clip.y, b.clip.y), z: l(a.clip.z, b.clip.z), w: l(a.clip.w, b.clip.w) },
    world: { x: l(a.world.x, b.world.x), y: l(a.world.y, b.world.y), z: l(a.world.z, b.world.z) },
    normal: { x: l(a.normal.x, b.normal.x), y: l(a.normal.y, b.normal.y), z: l(a.normal.z, b.normal.z) },
    uv: [l(a.uv[0], b.uv[0]), l(a.uv[1], b.uv[1])],
    color: { x: l(a.color.x, b.color.x), y: l(a.color.y, b.color.y), z: l(a.color.z, b.color.z) },
    bary: { x: 0, y: 0, z: 0 },
  };
}

function project(v: Varying, w: number, h: number): Screen {
  const invw = 1 / v.clip.w;
  const ndcx = v.clip.x * invw;
  const ndcy = v.clip.y * invw;
  const ndcz = v.clip.z * invw;
  return {
    sx: (ndcx * 0.5 + 0.5) * w,
    sy: (1 - (ndcy * 0.5 + 0.5)) * h,
    z: ndcz,
    invw,
    vy: v,
  };
}

function edge(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
}

function drawTriangle<U>(
  target: RenderTarget,
  material: Material<U>,
  uniforms: U,
  A: Varying,
  B: Varying,
  C: Varying,
  blend: 'opaque' | 'add' | 'alpha',
  cull: CullMode,
): void {
  const W = target.width;
  const H = target.height;
  const a = project(A, W, H);
  const b = project(B, W, H);
  const c = project(C, W, H);

  const area = edge(a.sx, a.sy, b.sx, b.sy, c.sx, c.sy);
  if (area === 0) return;
  if (cull === 'back' && area > 0) return;
  if (cull === 'front' && area < 0) return;

  const minX = Math.max(0, Math.floor(Math.min(a.sx, b.sx, c.sx)));
  const maxX = Math.min(W - 1, Math.ceil(Math.max(a.sx, b.sx, c.sx)));
  const minY = Math.max(0, Math.floor(Math.min(a.sy, b.sy, c.sy)));
  const maxY = Math.min(H - 1, Math.ceil(Math.max(a.sy, b.sy, c.sy)));
  const positive = area > 0;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let w0 = edge(b.sx, b.sy, c.sx, c.sy, px, py);
      let w1 = edge(c.sx, c.sy, a.sx, a.sy, px, py);
      let w2 = edge(a.sx, a.sy, b.sx, b.sy, px, py);
      if (positive ? w0 < 0 || w1 < 0 || w2 < 0 : w0 > 0 || w1 > 0 || w2 > 0) continue;
      w0 /= area;
      w1 /= area;
      w2 /= area;

      const z = w0 * a.z + w1 * b.z + w2 * c.z;
      const invw = w0 * a.invw + w1 * b.invw + w2 * c.invw;
      const varying = interpolate(a, b, c, w0, w1, w2, invw);
      const out = material.fragment(uniforms, varying);
      if (!out) continue;
      target.plot(x, y, z, out, blend);
    }
  }
}

// Perspective-correct barycentric interpolation: each attribute is weighted by
// invw, summed, then divided by the interpolated invw.
function interpolate(a: Screen, b: Screen, c: Screen, w0: number, w1: number, w2: number, invw: number): Varying {
  const f = (pa: number, pb: number, pc: number): number =>
    (w0 * pa * a.invw + w1 * pb * b.invw + w2 * pc * c.invw) / invw;
  const va = a.vy;
  const vb = b.vy;
  const vc = c.vy;
  return {
    // clip is unused downstream of rasterization; only world/normal/uv/color matter.
    clip: { x: 0, y: 0, z: 0, w: 1 / invw },
    world: {
      x: f(va.world.x, vb.world.x, vc.world.x),
      y: f(va.world.y, vb.world.y, vc.world.y),
      z: f(va.world.z, vb.world.z, vc.world.z),
    },
    normal: {
      x: f(va.normal.x, vb.normal.x, vc.normal.x),
      y: f(va.normal.y, vb.normal.y, vc.normal.y),
      z: f(va.normal.z, vb.normal.z, vc.normal.z),
    },
    uv: [f(va.uv[0], vb.uv[0], vc.uv[0]), f(va.uv[1], vb.uv[1], vc.uv[1])],
    color: {
      x: f(va.color.x, vb.color.x, vc.color.x),
      y: f(va.color.y, vb.color.y, vc.color.y),
      z: f(va.color.z, vb.color.z, vc.color.z),
    },
    bary: { x: w0, y: w1, z: w2 },
  };
}
