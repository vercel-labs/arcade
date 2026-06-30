import { hslToRgb } from './color.ts';
import { dot3, mat4MulDir, mat4MulVec4, normalize3, sub3, type Mat4, type Vec3 } from './math.ts';
import type { Material } from './shader.ts';
import { sampleTexture, type Texture } from './texture.ts';

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
}

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
  // Allocation-free fragment (runs once per covered pixel): manual normalize +
  // dot products and a reused RGBA, so no per-pixel Vec3/object churn. Same math
  // as a normalize3/sub3/dot3 formulation, just without the temporaries.
  fragment(u, vy) {
    const nx = vy.normal.x;
    const ny = vy.normal.y;
    const nz = vy.normal.z;
    let inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
    // Two-sided: flip the normal to face the camera (sign of n·view).
    const vdot = nx * (u.cameraPos.x - vy.world.x) + ny * (u.cameraPos.y - vy.world.y) + nz * (u.cameraPos.z - vy.world.z);
    if (vdot < 0) inv = -inv;
    const Nx = nx * inv;
    const Ny = ny * inv;
    const Nz = nz * inv;
    const key = u.keyStrength * Math.max(0, Nx * u.keyDir.x + Ny * u.keyDir.y + Nz * u.keyDir.z);
    const fill = u.fillStrength * Math.max(0, Nx * u.fillDir.x + Ny * u.fillDir.y + Nz * u.fillDir.z);
    const intensity = Math.min(1, u.ambient + key + fill);
    PIECE_RGBA.r = u.tint.x * intensity;
    PIECE_RGBA.g = u.tint.y * intensity;
    PIECE_RGBA.b = u.tint.z * intensity;
    return PIECE_RGBA;
  },
};
const PIECE_RGBA = { r: 0, g: 0, b: 0, a: 1 };

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

export interface WispUniforms {
  mvp: Mat4;
  logo: Texture; // RGBA source (decodePng)
  bg: Vec3; // the logo's background color (0..255) — the mark is whatever differs from it
  tint: Vec3; // brand hue (0..255) the whole wisp is colored with
  gain: number; // emissive multiplier; >1 pushes the core bright enough to bloom
  flicker: number; // 0..1+ per-frame brightness wobble (the "living flame" pulse)
  edge0: number; // mask soft-edge start, in normalized color-distance (0..1)
  edge1: number; // mask soft-edge end
}

// Emissive "will-o'-wisp" material: paints a logo as a glowing, brand-hued mark.
// The mark is extracted by how far each texel's color sits from the logo's own
// background (× its alpha), so it works for both opaque dark-background tiles and
// cut-out transparent logos. The whole thing is recolored to a single brand hue
// and drawn additively (over black), so bloom turns the bright core into a halo.
const NORM = 1 / Math.sqrt(3 * 255 * 255); // normalize an RGB distance to 0..1
const WISP_RGBA = { r: 0, g: 0, b: 0, a: 0 };
export const wispMaterial: Material<WispUniforms> = {
  cull: 'none',
  blend: 'add',
  vertex(u, vin) {
    const clip = mat4MulVec4(u.mvp, { x: vin.position.x, y: vin.position.y, z: vin.position.z, w: 1 });
    return { clip, world: vin.position, normal: vin.normal, uv: vin.uv, color: vin.color, bary: { x: 0, y: 0, z: 0 } };
  },
  fragment(u, vy) {
    const px = sampleTexture(u.logo, vy.uv[0], vy.uv[1]); // [r,g,b,a], a in 0..1
    const dr = px[0] - u.bg.x;
    const dg = px[1] - u.bg.y;
    const db = px[2] - u.bg.z;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db) * NORM;
    const mask = smoothstep(u.edge0, u.edge1, dist) * px[3];
    if (mask <= 0.002) return null; // background → discard, so only the mark glows
    WISP_RGBA.r = u.tint.x * u.gain;
    WISP_RGBA.g = u.tint.y * u.gain;
    WISP_RGBA.b = u.tint.z * u.gain;
    WISP_RGBA.a = Math.min(1, mask * u.flicker); // additive weight: tint*gain*mask*flicker
    return WISP_RGBA;
  },
};

export interface CoverUniforms {
  mvp: Mat4;
  model: Mat4;
  tex: Texture; // the square cover art (RGBA)
  paper: Vec3; // solid card color shown through transparent art (0..255)
  lightDir: Vec3; // normalized, world space, points toward the key light
  ambient: number; // 0..1 fill floor so a rotated cover never goes fully black
  brightness: number; // overall multiplier (1 for a face, <1 for its reflection)
  frameWidth: number; // bezel thickness in uv units (0 disables)
  frameColor: Vec3; // bezel color (0..255)
  pad: number; // inset the artwork by this many uv units (a paper margin inside the bezel)
  fade: number; // 0 = no vertical fade; 1 = fade by world.y (the reflection)
  fadeY0: number; // world.y fully faded (reflection's far bottom edge)
  fadeY1: number; // world.y at full brightness (the floor line)
}

// A lit, textured billboard for Cover Flow style covers. The cover is the full
// square texture composited over a solid `paper` color (so transparent-background
// icons still read as a cohesive solid card), shaded by a single key light:
// a head-on cover (normal +z) is fully lit and a cover rotated away dims by N·L,
// which is what physically sells the carousel's rotation. A thin bezel keeps the
// square silhouette legible when a cover is near edge-on, and an optional vertical
// fade (world.y) renders the faded floor reflection. Opaque; the depth buffer
// resolves overlap so covers can be submitted in any order.
const COVER_RGBA = { r: 0, g: 0, b: 0, a: 1 };
export const coverMaterial: Material<CoverUniforms> = {
  cull: 'none', // the reflection mirrors winding; depth handles occlusion regardless
  vertex(u, vin) {
    const clip = mat4MulVec4(u.mvp, { x: vin.position.x, y: vin.position.y, z: vin.position.z, w: 1 });
    const w = mat4MulVec4(u.model, { x: vin.position.x, y: vin.position.y, z: vin.position.z, w: 1 });
    const normal = mat4MulDir(u.model, vin.normal);
    return { clip, world: { x: w.x, y: w.y, z: w.z }, normal, uv: vin.uv, color: vin.color, bary: { x: 0, y: 0, z: 0 } };
  },
  fragment(u, vy) {
    const uvx = vy.uv[0];
    const uvy = vy.uv[1];
    let r: number;
    let g: number;
    let b: number;
    const border = Math.min(uvx, 1 - uvx, uvy, 1 - uvy);
    if (border < u.frameWidth) {
      r = u.frameColor.x;
      g = u.frameColor.y;
      b = u.frameColor.z;
    } else {
      // Inset the artwork by `pad` so it sits on a small paper margin rather than
      // hugging the bezel; the margin band itself shows the paper color.
      const iu = (uvx - u.pad) / (1 - 2 * u.pad);
      const iv = (uvy - u.pad) / (1 - 2 * u.pad);
      if (iu < 0 || iu > 1 || iv < 0 || iv > 1) {
        r = u.paper.x;
        g = u.paper.y;
        b = u.paper.z;
      } else {
        const px = sampleTexture(u.tex, iu, iv); // rgb 0..255, a 0..1
        const a = px[3];
        r = u.paper.x + (px[0] - u.paper.x) * a;
        g = u.paper.y + (px[1] - u.paper.y) * a;
        b = u.paper.z + (px[2] - u.paper.z) * a;
      }
    }
    let nx = vy.normal.x;
    let ny = vy.normal.y;
    let nz = vy.normal.z;
    const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
    nx *= inv;
    ny *= inv;
    nz *= inv;
    const ndl = Math.max(0, nx * u.lightDir.x + ny * u.lightDir.y + nz * u.lightDir.z);
    let bright = u.brightness * (u.ambient + (1 - u.ambient) * ndl);
    if (u.fade) {
      const f = (vy.world.y - u.fadeY0) / (u.fadeY1 - u.fadeY0);
      bright *= f < 0 ? 0 : f > 1 ? 1 : f;
    }
    COVER_RGBA.r = r * bright;
    COVER_RGBA.g = g * bright;
    COVER_RGBA.b = b * bright;
    return COVER_RGBA;
  },
};
