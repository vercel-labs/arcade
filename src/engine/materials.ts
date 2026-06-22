import { dot3, mat4MulDir, mat4MulVec4, normalize3, type Mat4, type Vec3 } from './math.ts';
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
    return { clip, world: vin.position, normal, uv: vin.uv, color: vin.color };
  },
  fragment(u, vy) {
    const n = normalize3(vy.normal);
    const intensity = Math.max(u.ambient, dot3(n, u.lightDir));
    return { r: vy.color.x * intensity, g: vy.color.y * intensity, b: vy.color.z * intensity, a: 1 };
  },
};
