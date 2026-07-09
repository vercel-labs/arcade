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
    const a = material.vertex(uniforms, mesh.vertices[idx[i]]);
    const b = material.vertex(uniforms, mesh.vertices[idx[i + 1]]);
    const c = material.vertex(uniforms, mesh.vertices[idx[i + 2]]);
    // Fast path: triangle fully in front of the near plane (the overwhelming
    // common case) needs no clipping — skip the array/lerp allocations entirely.
    if (a.clip.w > NEAR_W && b.clip.w > NEAR_W && c.clip.w > NEAR_W) {
      drawTriangle(target, material, uniforms, a, b, c, blend, cull);
      continue;
    }
    const poly = clipNear([a, b, c]);
    // Fan-triangulate the clipped polygon.
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
      // Early-Z: an opaque fragment behind what's already in the depth buffer would be
      // discarded by target.plot() anyway, so skip the (often textured) fragment shader
      // and the perspective interpolate for it. Behaviour-identical — same `z >= depth`
      // reject plot() applies — it just runs before the shader instead of after, which
      // cuts overdraw on stacked geometry (e.g. the deck stock) when drawn front-to-back.
      // Only opaque: add/alpha must still test-and-blend against nearer opaque geometry.
      if (blend === 'opaque' && z >= target.depth[y * W + x]) continue;
      const invw = w0 * a.invw + w1 * b.invw + w2 * c.invw;
      const varying = interpolate(a, b, c, w0, w1, w2, invw);
      const out = material.fragment(uniforms, varying);
      if (!out) continue;
      target.plot(x, y, z, out, blend);
    }
  }
}

// Single reused Varying scratch — interpolate() mutates it in place and returns
// it, so the per-pixel hot path allocates nothing (no fresh Varying + 6 nested
// objects per covered pixel). Safe because the fragment shader reads it
// synchronously and never retains the reference past its own return.
const SCRATCH: Varying = {
  clip: { x: 0, y: 0, z: 0, w: 1 },
  world: { x: 0, y: 0, z: 0 },
  normal: { x: 0, y: 0, z: 0 },
  uv: [0, 0],
  color: { x: 0, y: 0, z: 0 },
  bary: { x: 0, y: 0, z: 0 },
};

// Perspective-correct barycentric interpolation: each attribute is weighted by
// invw, summed, then divided by the interpolated invw.
function interpolate(a: Screen, b: Screen, c: Screen, w0: number, w1: number, w2: number, invw: number): Varying {
  const k0 = (w0 * a.invw) / invw;
  const k1 = (w1 * b.invw) / invw;
  const k2 = (w2 * c.invw) / invw;
  const va = a.vy;
  const vb = b.vy;
  const vc = c.vy;
  const o = SCRATCH;
  o.clip.w = 1 / invw;
  o.world.x = k0 * va.world.x + k1 * vb.world.x + k2 * vc.world.x;
  o.world.y = k0 * va.world.y + k1 * vb.world.y + k2 * vc.world.y;
  o.world.z = k0 * va.world.z + k1 * vb.world.z + k2 * vc.world.z;
  o.normal.x = k0 * va.normal.x + k1 * vb.normal.x + k2 * vc.normal.x;
  o.normal.y = k0 * va.normal.y + k1 * vb.normal.y + k2 * vc.normal.y;
  o.normal.z = k0 * va.normal.z + k1 * vb.normal.z + k2 * vc.normal.z;
  o.uv[0] = k0 * va.uv[0] + k1 * vb.uv[0] + k2 * vc.uv[0];
  o.uv[1] = k0 * va.uv[1] + k1 * vb.uv[1] + k2 * vc.uv[1];
  o.color.x = k0 * va.color.x + k1 * vb.color.x + k2 * vc.color.x;
  o.color.y = k0 * va.color.y + k1 * vb.color.y + k2 * vc.color.y;
  o.color.z = k0 * va.color.z + k1 * vb.color.z + k2 * vc.color.z;
  o.bary.x = w0;
  o.bary.y = w1;
  o.bary.z = w2;
  return o;
}
