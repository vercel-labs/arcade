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
  // Allocation-free fragment (runs once per covered pixel — the table + chair ring
  // cover most of the screen). Same math as normalize3 + dot3, without the per-pixel
  // Vec3 and result-object temporaries: reuse LAMBERT_RGBA and inline the normalize
  // (Math.hypot + the || 1 zero-length guard, matching normalize3 exactly).
  fragment(u, vy) {
    const nx = vy.normal.x;
    const ny = vy.normal.y;
    const nz = vy.normal.z;
    const l = Math.hypot(nx, ny, nz) || 1;
    const ndl = (nx / l) * u.lightDir.x + (ny / l) * u.lightDir.y + (nz / l) * u.lightDir.z;
    const intensity = Math.max(u.ambient, ndl);
    LAMBERT_RGBA.r = vy.color.x * intensity;
    LAMBERT_RGBA.g = vy.color.y * intensity;
    LAMBERT_RGBA.b = vy.color.z * intensity;
    return LAMBERT_RGBA;
  },
};
const LAMBERT_RGBA = { r: 0, g: 0, b: 0, a: 1 };

export interface FeltUniforms {
  mvp: Mat4;
  model: Mat4;
  lightDir: Vec3; // normalized, world space, points toward the light
  ambient: number; // 0..1 floor
  stipple: Vec3; // fleck color (0..255), added on top of the lit base
  stippleFreq: number; // stipple lattice cells per OBJECT-space unit
  stippleDensity: number; // 0..1 — fraction of lattice cells that carry a fleck
  stippleGain: number; // fleck strength (peaks at the cell centre, falls to 0 at its rim)
  stippleRadius: number; // fleck disc radius in lattice-cell units (<= 0.5)
}

// Matte diffuse surface (per-vertex base color × N·L) sprinkled with a sparse,
// SURFACE-LOCKED ASCII stipple. A flat, uniformly-lit matte plane has one
// brightness across every cell, so the shape-glyph presenter matches it to blank
// space — a big felt reads as a dead black hole (which is exactly why the poker
// felt used to be painted black). The stipple scatters faint flecks keyed to
// OBJECT-space x/z (so they stick to the surface as the camera orbits instead of
// crawling), giving occasional cells one small bright region that the matcher
// resolves to a low-coverage glyph ('.'/','/'`'/'o'). Density/gain stay low so the
// surface reads as textured felt, not a starfield. Non-flat use is fine too — the
// lattice is 2D in the mesh's x/z, so it tiles any surface facing roughly up.
const FELT_RGBA = { r: 0, g: 0, b: 0, a: 1 };
export const feltMaterial: Material<FeltUniforms> = {
  cull: 'none',
  vertex(u, vin) {
    const clip = mat4MulVec4(u.mvp, { x: vin.position.x, y: vin.position.y, z: vin.position.z, w: 1 });
    const normal = mat4MulDir(u.model, vin.normal);
    // world = OBJECT-space position: the stipple lattice lives in the mesh's own
    // frame, so it's invariant to the model/camera transform (no swim, no crawl).
    return { clip, world: vin.position, normal, uv: vin.uv, color: vin.color, bary: { x: 0, y: 0, z: 0 } };
  },
  fragment(u, vy) {
    const nx = vy.normal.x;
    const ny = vy.normal.y;
    const nz = vy.normal.z;
    const l = Math.hypot(nx, ny, nz) || 1;
    const ndl = (nx / l) * u.lightDir.x + (ny / l) * u.lightDir.y + (nz / l) * u.lightDir.z;
    const intensity = Math.max(u.ambient, ndl);
    let r = vy.color.x * intensity;
    let g = vy.color.y * intensity;
    let b = vy.color.z * intensity;
    // Surface-locked stipple: hash the lattice cell under this point; a fraction
    // `stippleDensity` of cells carry a fleck, brightest at the cell centre and
    // fading to nothing at radius `stippleRadius` — a soft round speck.
    const fx = vy.world.x * u.stippleFreq;
    const fz = vy.world.z * u.stippleFreq;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    if (feltHash(ix, iz) < u.stippleDensity) {
      const dx = fx - ix - 0.5;
      const dz = fz - iz - 0.5;
      const rr = u.stippleRadius * u.stippleRadius;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr) {
        const k = (1 - d2 / rr) * u.stippleGain;
        r += u.stipple.x * k;
        g += u.stipple.y * k;
        b += u.stipple.z * k;
      }
    }
    FELT_RGBA.r = r;
    FELT_RGBA.g = g;
    FELT_RGBA.b = b;
    return FELT_RGBA;
  },
};

// Cheap, stable 2D integer hash → [0,1). Deterministic per lattice cell, so the
// stipple is fixed to the surface and never shimmers frame to frame.
function feltHash(ix: number, iz: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) | 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

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
  logo: Texture; // RGBA source whose ALPHA is pre-baked mark coverage (see logo-mark.ts)
  tint: Vec3; // brand hue (0..255) the whole wisp is colored with
  gain: number; // emissive multiplier; >1 pushes the core bright enough to bloom
  flicker: number; // 0..1+ per-frame brightness wobble (the "living flame" pulse)
}

// Emissive "will-o'-wisp" material: paints a logo's mark as a glowing, brand-hued
// flame. Masking is decided ONCE at load time (bakeMarkAlpha → coverage stored in
// the texture's alpha), so this shader is pure recoloring: it reads coverage from
// alpha and tints it, and never re-derives the mark from color. That separation is
// what lets multi-color marks keep every region — the shader can't discard a hue
// for being "too close to the background", because it no longer looks at color.
// Drawn additively over black, so bloom turns the bright core into a halo.
const WISP_RGBA = { r: 0, g: 0, b: 0, a: 0 };
export const wispMaterial: Material<WispUniforms> = {
  cull: 'none',
  blend: 'add',
  vertex(u, vin) {
    const clip = mat4MulVec4(u.mvp, { x: vin.position.x, y: vin.position.y, z: vin.position.z, w: 1 });
    return { clip, world: vin.position, normal: vin.normal, uv: vin.uv, color: vin.color, bary: { x: 0, y: 0, z: 0 } };
  },
  fragment(u, vy) {
    const px = sampleTexture(u.logo, vy.uv[0], vy.uv[1]); // [r,g,b,a]; a = baked coverage 0..1
    const mask = px[3];
    if (mask <= 0.002) return null; // background → discard, so only the mark glows
    WISP_RGBA.r = u.tint.x * u.gain;
    WISP_RGBA.g = u.tint.y * u.gain;
    WISP_RGBA.b = u.tint.z * u.gain;
    WISP_RGBA.a = Math.min(1, mask * u.flicker); // additive weight: tint*gain*coverage*flicker
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
