import { dot3, mat4MulDir, mat4MulVec4, normalize3, sub3, type Mat4, type Vec3 } from './math.ts';
import type { Material } from './shader.ts';

export interface LambertUniforms {
  mvp: Mat4;
  model: Mat4;
  lightDir: Vec3; // normalized, world space, points toward the light
  ambient: number; // 0..1 floor
}

// Flat/diffuse lit material: the per-vertex base color scaled by N·L.
export const lambertMaterial: Material<LambertUniforms> = {
  cull: 'none',
  vertex(u, vin) {
    const clip = mat4MulVec4(u.mvp, { x: vin.position.x, y: vin.position.y, z: vin.position.z, w: 1 });
    const normal = mat4MulDir(u.model, vin.normal);
    return { clip, world: vin.position, normal, uv: vin.uv, color: vin.color, bary: { x: 0, y: 0, z: 0 } };
  },
  fragment(u, vy) {
    const n = normalize3(vy.normal);
    const intensity = Math.max(u.ambient, dot3(n, u.lightDir));
    return { r: vy.color.x * intensity, g: vy.color.y * intensity, b: vy.color.z * intensity, a: 1 };
  },
};

export interface GlassUniforms {
  mvp: Mat4;
  model: Mat4;
  cameraPos: Vec3;
  edgeColor: Vec3; // bright edge glow (0..255)
  edgeWidth: number; // edge thickness in barycentric units (~0.02–0.06)
  bodyColor: Vec3; // faint internal tint (0..255)
  bodyStrength: number; // 0..1, how visible the glass body is
}

// Glowing-glass material: bright edges from the barycentric distance to each
// triangle edge, plus a faint Fresnel-driven body that brightens at grazing
// angles. Meant to be drawn additively over the rainbow so the glass reads as
// translucent — you see the spectrum through it, with the edges catching light.
export const glassMaterial: Material<GlassUniforms> = {
  cull: 'none',
  blend: 'add',
  vertex(u, vin) {
    const clip = mat4MulVec4(u.mvp, { x: vin.position.x, y: vin.position.y, z: vin.position.z, w: 1 });
    const w = mat4MulVec4(u.model, { x: vin.position.x, y: vin.position.y, z: vin.position.z, w: 1 });
    const normal = mat4MulDir(u.model, vin.normal);
    return { clip, world: { x: w.x, y: w.y, z: w.z }, normal, uv: vin.uv, color: vin.color, bary: { x: 0, y: 0, z: 0 } };
  },
  fragment(u, vy) {
    const e = Math.min(vy.bary.x, vy.bary.y, vy.bary.z);
    const edge = 1 - smoothstep(0, u.edgeWidth, e);
    const view = normalize3(sub3(u.cameraPos, vy.world));
    const facing = Math.abs(dot3(normalize3(vy.normal), view));
    const body = (1 - facing) * u.bodyStrength; // grazing faces shimmer faintly
    return {
      r: u.edgeColor.x * edge + u.bodyColor.x * body,
      g: u.edgeColor.y * edge + u.bodyColor.y * body,
      b: u.edgeColor.z * edge + u.bodyColor.z * body,
      a: 1,
    };
  },
};

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
