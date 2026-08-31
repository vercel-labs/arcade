import { hslToRgb } from './color.ts';
import { dot3, mat4MulDir, mat4MulVec4, normalize3, sub3, type Mat4, type Vec3 } from './math.ts';
import type { Material } from './shader.ts';
import { sampleTexture, type Texture } from './texture-data.ts';

export interface LambertUniforms {
  mvp: Mat4;
  model: Mat4;
  lightDir: Vec3; // normalized, world space, points toward the light
  ambient: number; // 0..1 floor
  wrap?: number; // 0/undefined = hard Lambert; →1 wraps the falloff toward half-Lambert so a larger share of the surface is lit
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
    const w = u.wrap;
    const intensity = Math.max(u.ambient, w ? (ndl + w) / (1 + w) : ndl);
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

export interface WaterUniforms {
  mvp: Mat4;
  model: Mat4;
  time: number;
  cameraPos: Vec3;
  sunDirection: Vec3;
  deepColor: Vec3;
  surfaceColor: Vec3;
  skyColor: Vec3;
  horizonColor: Vec3;
  currentColor: Vec3;
  flowSpeed: number;
}

// Low-poly water in two scales: the vertex stage displaces a subdivided surface with broad,
// low-amplitude swells; the fragment stage layers much smaller moving normal detail over the
// interpolated geometric normal. Specular light is camera-aware, so highlights follow surface
// shape instead of being painted bands. This is the CPU analogue of layered scrolling water
// normals, without textures, reflection passes, or GPU-only simulation.
const WATER_RGBA = { r: 0, g: 0, b: 0, a: 1 };
export const waterMaterial: Material<WaterUniforms> = {
  cull: 'none',
  vertex(u, vin) {
    const wave = waterGeometrySample(vin.position.x, vin.position.z, u.time, u.flowSpeed);
    const position = { x: vin.position.x, y: vin.position.y + wave.height, z: vin.position.z };
    const objectNormal = { x: -wave.gx, y: 1, z: -wave.gz };
    const clip = mat4MulVec4(u.mvp, { x: position.x, y: position.y, z: position.z, w: 1 });
    const world = mat4MulVec4(u.model, { x: position.x, y: position.y, z: position.z, w: 1 });
    return {
      clip,
      world: { x: world.x, y: world.y, z: world.z },
      normal: mat4MulDir(u.model, objectNormal),
      uv: vin.uv,
      color: vin.color,
      bary: { x: 0, y: 0, z: 0 },
    };
  },
  fragment(u, vy) {
    const x = vy.world.x;
    const z = vy.world.z;
    const t = u.time;

    // Two drifting noise octaves warp three sub-tile normal waves. Their short wavelengths
    // create several ripples per tile; because only their combined normal is lit, none appears
    // as a complete repeating line.
    const coarse = waterNoise(x * 0.17 + t * 0.012, z * 0.17 - t * 0.009);
    const fine = waterNoise(x * 0.83 - t * 0.031 + 11.7, z * 0.83 + t * 0.023 - 4.3);
    const warpX = (coarse - 0.5) * 0.62 + (fine - 0.5) * 0.24;
    const warpZ = (coarse - 0.5) * -0.38 + (fine - 0.5) * 0.31;
    // A cheap curl field around an off-centre eddy bends the local flow direction. It plays
    // the role of a procedural flow map: each normal layer samples a different projection of
    // the same smooth vortex plus independently weighted domain noise.
    const eddyX = x + 4.6;
    const eddyZ = z - 2.3;
    const eddyFalloff = 1 / (1 + (eddyX * eddyX + eddyZ * eddyZ) * 0.085);
    const curlX = -eddyZ * eddyFalloff;
    const curlZ = eddyX * eddyFalloff;
    const flowWarp1 = warpX * 7.2 + warpZ * 3 + (curlX * 1.4 + curlZ * 10.4) * 0.11;
    const flowWarp2 = -warpX * 5.1 + warpZ * 6.3 + (curlX * -8.8 + curlZ * 7.9) * -0.085;
    const flowWarp3 = (fine - 0.5) * 6.6 + (coarse - 0.5) * 3.2 + (curlX * 12.6 - curlZ * 6.7) * 0.065;
    const p1 = x * 1.4 + z * 10.4 - t * u.flowSpeed * 2.3 + flowWarp1;
    const p2 = x * -8.8 + z * 7.9 - t * u.flowSpeed * 2.9 + flowWarp2 + 1.7;
    const p3 = x * 12.6 - z * 6.7 - t * u.flowSpeed * 3.7 + flowWarp3 - 0.6;
    let vx = u.cameraPos.x - x;
    let vyEye = u.cameraPos.y - vy.world.y;
    let vz = u.cameraPos.z - z;
    const viewDistance = Math.sqrt(vx * vx + vyEye * vyEye + vz * vz);
    const detailLod = Math.max(0.12, Math.min(1, (22 - viewDistance) / 12));
    const c1 = Math.cos(p1);
    const c2 = Math.cos(p2);
    const c3 = Math.cos(p3);
    const fineGx = (c1 * 0.0112 - c2 * 0.0792 + c3 * 0.0756) * detailLod;
    const fineGz = (c1 * 0.0832 + c2 * 0.0711 - c3 * 0.0402) * detailLod;

    // Combine physical mesh slope and finer normal-map-like detail, then use a camera/light
    // half vector for specular response (the same core relationship used by reflective water).
    let nx = vy.normal.x - fineGx * 1.35;
    let ny = vy.normal.y;
    let nz = vy.normal.z - fineGz * 1.35;
    let inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
    nx *= inv;
    ny *= inv;
    nz *= inv;
    inv = 1 / viewDistance;
    vx *= inv;
    vyEye *= inv;
    vz *= inv;
    let hx = vx + u.sunDirection.x;
    let hy = vyEye + u.sunDirection.y;
    let hz = vz + u.sunDirection.z;
    inv = 1 / Math.sqrt(hx * hx + hy * hy + hz * hz);
    hx *= inv;
    hy *= inv;
    hz *= inv;
    const reflectionFacing = Math.max(0, nx * hx + ny * hy + nz * hz);
    const softReflection = smoothstep(0.78, 0.9, reflectionFacing);
    const sharpReflection = smoothstep(0.87, 0.97, reflectionFacing);
    const reflectionNoise = coarse * 0.38 + fine * 0.62;
    const interference = 0.5 + c1 * 0.18 + c2 * 0.13 + c3 * 0.1;
    const microPatch = smoothstep(0.46, 0.7, interference);
    // A broad, broken crest signal remains visible under diffuse sky light even when the
    // camera is nowhere near the sun's reflection vector. Domain-warped phases keep this from
    // becoming parallel contour lines; centering it at zero preserves the overall water value.
    const rippleCrest = 0.5 + c1 * 0.22 + c2 * 0.18 + c3 * 0.1;
    const diffuseCrest = smoothstep(0.56, 0.88, rippleCrest) * (0.25 + fine * 0.75) * detailLod;
    const glintPatch = smoothstep(0.32, 0.74, reflectionNoise) * (0.04 + smoothstep(0.36, 0.72, fine) * 0.48 + microPatch * 0.48);
    const reflection = Math.min(1, (softReflection * 0.16 + sharpReflection * 0.84) * (0.08 + glintPatch * 0.92));

    // Fresnel-like edge lift is subtle at this camera angle but keeps glancing water brighter
    // than facets facing the camera head-on. Broad noise supplies restrained depth variation.
    const viewFacing = Math.max(0, nx * vx + ny * vyEye + nz * vz);
    const oneMinusView = 1 - viewFacing;
    const fresnel = 0.04 + 0.96 * oneMinusView * oneMinusView * oneMinusView * oneMinusView * oneMinusView;
    // Reflect the eye ray into a tiny procedural environment. Looking down samples muted sky;
    // grazing facets sample a narrow warm horizon band. This makes a low camera read as water
    // reflecting a world rather than as cyan stripes painted onto a dark plane.
    const reflectedY = -vyEye + 2 * viewFacing * ny;
    const horizonBand = 1 - smoothstep(0.012, 0.2, Math.abs(reflectedY));
    const skyUp = smoothstep(-0.08, 0.82, reflectedY);
    const brokenHorizon = horizonBand * (0.16 + glintPatch * 0.58 + microPatch * 0.26);
    const horizonWarmth = brokenHorizon * (0.72 + glintPatch * 0.28);
    const er0 = u.deepColor.x + (u.skyColor.x - u.deepColor.x) * (0.34 + skyUp * 0.66);
    const eg0 = u.deepColor.y + (u.skyColor.y - u.deepColor.y) * (0.34 + skyUp * 0.66);
    const eb0 = u.deepColor.z + (u.skyColor.z - u.deepColor.z) * (0.34 + skyUp * 0.66);
    const er = er0 + (u.horizonColor.x - er0) * horizonWarmth;
    const eg = eg0 + (u.horizonColor.y - eg0) * horizonWarmth;
    const eb = eb0 + (u.horizonColor.z - eb0) * horizonWarmth;
    const sunFacing = Math.max(0, nx * u.sunDirection.x + ny * u.sunDirection.y + nz * u.sunDirection.z);
    // Two broad sky lobes illuminate opposing slope directions. They are deliberately much
    // softer than the sun reflection: their job is to preserve readable surface variation as
    // the board rotates, without making the water glow or pinning all highlights to one edge.
    const skyFacingA = Math.max(0, nx * -0.28 + ny * 0.93 + nz * 0.24);
    const skyFacingB = Math.max(0, nx * 0.36 + ny * 0.91 + nz * -0.18);
    const broadSkyA = smoothstep(0.84, 0.98, skyFacingA) * (0.5 + glintPatch * 0.5);
    const broadSkyB = smoothstep(0.855, 0.982, skyFacingB) * (0.46 + microPatch * 0.54);
    const broadSky = Math.min(1, broadSkyA * 0.58 + broadSkyB * 0.42);
    const baseMix = Math.max(
      0,
      Math.min(
        1,
        // Centred noise creates broad, irregular light pools that remain resolvable when a
        // shallow camera foreshortens the finer crests into less than one terminal cell.
        0.4 + (coarse - 0.5) * 0.16 + (fine - 0.5) * 0.18 + (rippleCrest - 0.5) * 0.28 + microPatch * 0.045 + fresnel * 0.1 + (sunFacing - 0.72) * 0.2,
      ),
    );
    const br = u.deepColor.x + (u.surfaceColor.x - u.deepColor.x) * baseMix;
    const bg = u.deepColor.y + (u.surfaceColor.y - u.deepColor.y) * baseMix;
    const bb = u.deepColor.z + (u.surfaceColor.z - u.deepColor.z) * baseMix;
    const environmentMix = Math.min(0.66, 0.115 + fresnel * 0.4 + broadSky * 0.22 + brokenHorizon * 0.06 + (1 - detailLod) * fresnel * 0.04);
    const envR = br + (er - br) * environmentMix;
    const envG = bg + (eg - bg) * environmentMix;
    const envB = bb + (eb - bb) * environmentMix;
    // Sparse crest fragments scatter muted sky light. Unlike the view-dependent specular
    // term, this survives unfavorable camera rotations and gives ASCII matching an actual
    // within-cell edge to describe instead of a field of identical dark punctuation.
    const crestLift = diffuseCrest * 0.28;
    const crestR = envR + (u.skyColor.x - envR) * crestLift;
    const crestG = envG + (u.skyColor.y - envG) * crestLift;
    const crestB = envB + (u.skyColor.z - envB) * crestLift;
    const glintMix = reflection * (0.44 + fresnel * 0.34);
    WATER_RGBA.r = crestR + (u.currentColor.x - crestR) * glintMix;
    WATER_RGBA.g = crestG + (u.currentColor.y - crestG) * glintMix;
    WATER_RGBA.b = crestB + (u.currentColor.z - crestB) * glintMix;
    return WATER_RGBA;
  },
};

const WATER_GEOMETRY_SAMPLE = { height: 0, gx: 0, gz: 0 };

// Coarse physical swells for the subdivided mesh. These are deliberately broader and much
// lower than the fragment ripples: geometry supplies an uneven silhouette/facets, while the
// normal detail supplies the many small reflections the terminal can actually resolve.
function waterGeometrySample(x: number, z: number, time: number, flowSpeed: number): typeof WATER_GEOMETRY_SAMPLE {
  const broad = waterNoise(x * 0.095 + time * 0.008, z * 0.095 - time * 0.006) - 0.5;
  const detail = waterNoise(x * 0.29 - time * 0.011 + 5.7, z * 0.29 + time * 0.009 - 3.4) - 0.5;
  const eddyX = x - 3.2;
  const eddyZ = z + 4.1;
  const eddyFalloff = 1 / (1 + (eddyX * eddyX + eddyZ * eddyZ) * 0.07);
  const curlX = -eddyZ * eddyFalloff;
  const curlZ = eddyX * eddyFalloff;
  const p1 = x * 0.32 + z * 1.38 - time * flowSpeed * 0.55 + broad * 3.1 + detail * 1.3 + (curlX * 0.32 + curlZ * 1.38) * 0.24;
  const p2 = x * -0.74 + z * 1.92 - time * flowSpeed * 0.82 - broad * 2.2 + detail * 2.4 - (curlX * -0.74 + curlZ * 1.92) * 0.18 + 2.1;
  const p3 = x * 1.46 + z * 0.68 - time * flowSpeed * 1.07 + broad * 1.4 - detail * 2.7 + (curlX * 1.46 + curlZ * 0.68) * 0.14 - 0.7;
  const c1 = Math.cos(p1);
  const c2 = Math.cos(p2);
  const c3 = Math.cos(p3);
  WATER_GEOMETRY_SAMPLE.height = Math.sin(p1) * 0.032 + Math.sin(p2) * 0.021 + Math.sin(p3) * 0.013;
  WATER_GEOMETRY_SAMPLE.gx = c1 * 0.01024 - c2 * 0.01554 + c3 * 0.01898;
  WATER_GEOMETRY_SAMPLE.gz = c1 * 0.04416 + c2 * 0.04032 + c3 * 0.00884;
  return WATER_GEOMETRY_SAMPLE;
}

function waterNoise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = waterHash(ix, iz);
  const b = waterHash(ix + 1, iz);
  const c = waterHash(ix, iz + 1);
  const d = waterHash(ix + 1, iz + 1);
  const ab = a + (b - a) * sx;
  const cd = c + (d - c) * sx;
  return ab + (cd - ab) * sz;
}

function waterHash(ix: number, iz: number): number {
  let h = (Math.imul(ix, 0x1f123bb5) ^ Math.imul(iz, 0x5f356495)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) | 0;
  h ^= h >>> 12;
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
