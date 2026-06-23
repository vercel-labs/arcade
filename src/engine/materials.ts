import { hslToRgb } from './color.ts';
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

export interface PieceUniforms {
  mvp: Mat4;
  model: Mat4;
  cameraPos: Vec3; // world-space eye, for two-sided normal correction
  keyDir: Vec3; // normalized, points toward the key light
  fillDir: Vec3; // normalized, points toward the (weaker) fill light
  keyStrength: number; // 0..1+, key contribution
  fillStrength: number; // 0..1, fill contribution (lifts shadows without flattening)
  ambient: number; // 0..1 floor (keep low for prominent shadows)
  tint: Vec3; // base color 0..255 — drives the piece's color (white/brown/…)
  glow?: Vec3; // optional highlight color; the lit color is blended toward it (e.g. hover)
}

// Fraction the lit color is pulled toward `glow` when present (hover highlight).
const GLOW_MIX = 0.42;

// Solid object material with a two-light rig (key + fill) and a flat color
// `tint`. Color identifies the piece set; fixed world-space lights sculpt the
// form, and a two-sided normal correction makes lighting consistent even though
// these assets have inconsistent normal orientation (some sub-meshes mirrored).
export const pieceMaterial: Material<PieceUniforms> = {
  // No culling: the chess assets have mixed triangle winding (some sub-meshes
  // are mirrored), so back-face culling drops faces from one side. The z-buffer
  // handles occlusion regardless, and culling saved little here anyway.
  cull: 'none',
  vertex(u, vin) {
    const clip = mat4MulVec4(u.mvp, { x: vin.position.x, y: vin.position.y, z: vin.position.z, w: 1 });
    const w = mat4MulVec4(u.model, { x: vin.position.x, y: vin.position.y, z: vin.position.z, w: 1 });
    const normal = mat4MulDir(u.model, vin.normal);
    return { clip, world: { x: w.x, y: w.y, z: w.z }, normal, uv: vin.uv, color: u.tint, bary: { x: 0, y: 0, z: 0 } };
  },
  fragment(u, vy) {
    let n = normalize3(vy.normal);
    // Two-sided: flip the normal to face the camera so the *visible* surface is
    // always shaded by its true outward direction — regardless of whether the
    // asset stored the normal pointing in or out. This is what makes every piece
    // light the same way instead of king/bishop reading inverted.
    const view = sub3(u.cameraPos, vy.world);
    if (dot3(n, view) < 0) n = { x: -n.x, y: -n.y, z: -n.z };
    const key = u.keyStrength * Math.max(0, dot3(n, u.keyDir));
    const fill = u.fillStrength * Math.max(0, dot3(n, u.fillDir));
    // Clamp to 1 so bright tints (e.g. ivory) never blow out to white: every
    // tint then sweeps the identical shadow→lit gradient, differing only in hue.
    const intensity = Math.min(1, u.ambient + key + fill);
    let r = u.tint.x * intensity;
    let g = u.tint.y * intensity;
    let b = u.tint.z * intensity;
    if (u.glow) {
      r += (u.glow.x - r) * GLOW_MIX;
      g += (u.glow.y - g) * GLOW_MIX;
      b += (u.glow.z - b) * GLOW_MIX;
    }
    return { r, g, b, a: 1 };
  },
};

export interface GlassUniforms {
  mvp: Mat4;
  model: Mat4;
  cameraPos: Vec3;
  edgeColor: Vec3; // bright edge glow (0..255)
  edgeWidth: number; // edge thickness in barycentric units (~0.02–0.06)
  glassColor: Vec3; // glass body tint (0..255)
  bodyStrength: number; // 0..1, overall fill brightness
  ambient: number; // 0..1, minimum fill so faces are always filled (not just rims)
  fresnelPower: number; // higher = brighter only at grazing faces
  dispersion: number; // 0..1, strength of the internal rainbow sheen
}

// Glassy, FILLED prism material. Each face is filled (not just outlined): a
// glass-tinted body brightened at grazing faces (Fresnel), an internal rainbow
// sheen driven by world position (fake dispersion — the spectrum you see inside
// real glass), and bright barycentric edges on top. Drawn additively over the
// rainbow so the glass still reads as translucent.
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
    const facing = Math.abs(dot3(normalize3(vy.normal), view)); // 1 face-on, 0 edge-on
    const fres = Math.pow(1 - facing, u.fresnelPower);
    // Filled body: always at least `ambient`, brighter toward grazing faces.
    const body = u.bodyStrength * (u.ambient + (1 - u.ambient) * fres);

    // Internal dispersion: a smooth hue gradient across the glass volume (shifts
    // as the prism rotates because it's keyed to world position).
    const hue = (vy.world.y * 120 + vy.world.x * 70 + 200) % 360;
    const [dr, dg, db] = hslToRgb(hue < 0 ? hue + 360 : hue, 1, 0.5);
    const disp = u.dispersion * (0.35 + 0.65 * fres);

    return {
      r: u.edgeColor.x * edge + u.glassColor.x * body + dr * disp,
      g: u.edgeColor.y * edge + u.glassColor.y * body + dg * disp,
      b: u.edgeColor.z * edge + u.glassColor.z * body + db * disp,
      a: 1,
    };
  },
};

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
