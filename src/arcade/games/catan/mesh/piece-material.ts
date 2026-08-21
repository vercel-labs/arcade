// Catan player-piece lighting. Most colors keep the broad, readable wrapped Lambert look used
// by the board, while ivory pieces get a steeper light-to-shadow curve. That distinction matters
// in ASCII mode: a flat, uniform shadow repeatedly resolves to one glyph across every plane and
// hides the form, whereas separated face values preserve the building's silhouette.

import { mat4MulDir, mat4MulVec4, type Mat4, type Material, type Vec3 } from '../../../../engine/index.ts';

export interface CatanPieceUniforms {
  mvp: Mat4;
  model: Mat4;
  lightDir: Vec3;
  ambient: number;
  wrap: number;
}

const WHITE_CHANNEL_FLOOR = 235;
const WHITE_SHADOW = 0.4;
const WHITE_LIGHT_START = 0.2;
const WHITE_LIGHT_END = 0.78;
const SHADOW_AXIS_X = 0.8;
const SHADOW_AXIS_Z = -0.6;
const DARK_COLOR_LUMINANCE = 0.58;

// Wrapped Lambert lighting intentionally gives pieces a broad readable shadow, but its flat
// floor used to collapse every away-facing plane to one RGB value—and therefore one repeated
// ASCII glyph. Keep the same overall shadow brightness while separating differently oriented
// planes into a small range of values. Because this depends only on the face normal, each face
// stays clean and solid rather than acquiring noisy per-pixel stipple.
function separatedShadow(base: number, nx: number, nz: number, range: number): number {
  const facing = Math.max(-1, Math.min(1, nx * SHADOW_AXIS_X + nz * SHADOW_AXIS_Z));
  return base + facing * range;
}

export const catanPieceMaterial: Material<CatanPieceUniforms> = {
  cull: 'none',
  webgpu: {
    wgsl: /* wgsl */ `
struct VertexIn {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
  @location(3) color: vec3f,
};
struct VertexOut {
  @builtin(position) clip: vec4f,
  @location(0) normal: vec3f,
  @location(1) color: vec3f,
};
struct Uniforms {
  mvp: mat4x4f,
  model: mat4x4f,
  lightAmbient: vec4f,
  wrap: vec4f,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

@vertex fn vertexMain(input: VertexIn) -> VertexOut {
  let clip = u.mvp * vec4f(input.position, 1.0);
  var out: VertexOut;
  out.clip = vec4f(clip.xy, (clip.z + clip.w) * 0.5, clip.w);
  out.normal = (u.model * vec4f(input.normal, 0.0)).xyz;
  out.color = input.color / 255.0;
  return out;
}

fn separatedShadow(base: f32, nx: f32, nz: f32, range: f32) -> f32 {
  let facing = clamp(nx * 0.8 + nz * -0.6, -1.0, 1.0);
  return base + facing * range;
}

@fragment fn fragmentMain(input: VertexOut) -> @location(0) vec4f {
  let n = normalize(input.normal);
  let ndl = dot(n, u.lightAmbient.xyz);
  let white = all(input.color >= vec3f(${WHITE_CHANNEL_FLOOR / 255}));
  var intensity: f32;
  if (white) {
    let linear = clamp((ndl - ${WHITE_LIGHT_START}) / (${WHITE_LIGHT_END} - ${WHITE_LIGHT_START}), 0.0, 1.0);
    let key = linear * linear * (3.0 - 2.0 * linear);
    let shadow = separatedShadow(${WHITE_SHADOW}, n.x, n.z, 0.055);
    intensity = shadow + (1.0 - shadow) * key;
  } else {
    let wrapped = (ndl + u.wrap.x) / (1.0 + u.wrap.x);
    let baseLuminance = dot(input.color, vec3f(0.299, 0.587, 0.114));
    let darkBoost = clamp((${DARK_COLOR_LUMINANCE} - baseLuminance) / 0.18, 0.0, 1.0);
    let shadow = separatedShadow(u.lightAmbient.w + darkBoost * 0.04, n.x, n.z, 0.065 + darkBoost * 0.075);
    intensity = max(shadow, wrapped);
  }
  return vec4f(input.color * intensity, 1.0);
}
`,
    writeUniforms(out, uniforms) {
      out.set(uniforms.mvp, 0);
      out.set(uniforms.model, 16);
      out.set([uniforms.lightDir.x, uniforms.lightDir.y, uniforms.lightDir.z, uniforms.ambient], 32);
      out[36] = uniforms.wrap;
    },
  },
  vertex(u, vin) {
    const clip = mat4MulVec4(u.mvp, { x: vin.position.x, y: vin.position.y, z: vin.position.z, w: 1 });
    const normal = mat4MulDir(u.model, vin.normal);
    return { clip, world: vin.position, normal, uv: vin.uv, color: vin.color, bary: { x: 0, y: 0, z: 0 } };
  },
  fragment(u, vy) {
    const nx = vy.normal.x;
    const ny = vy.normal.y;
    const nz = vy.normal.z;
    const invLength = 1 / (Math.hypot(nx, ny, nz) || 1);
    const unitX = nx * invLength;
    const unitY = ny * invLength;
    const unitZ = nz * invLength;
    const ndl = unitX * u.lightDir.x + unitY * u.lightDir.y + unitZ * u.lightDir.z;
    const white = vy.color.x >= WHITE_CHANNEL_FLOOR && vy.color.y >= WHITE_CHANNEL_FLOOR && vy.color.z >= WHITE_CHANNEL_FLOOR;
    let intensity: number;
    if (white) {
      // A smooth but fairly narrow key-light band keeps the roof brilliant and one adjoining
      // wall clearly lit, while the opposite wall drops far enough down the luminance range to
      // avoid a solid W-shaped patch. Unlike a square-root curve, this does not lift middling
      // side normals until they are almost as bright as the roof.
      const linear = Math.max(0, Math.min(1, (ndl - WHITE_LIGHT_START) / (WHITE_LIGHT_END - WHITE_LIGHT_START)));
      const key = linear * linear * (3 - 2 * linear);
      const shadow = separatedShadow(WHITE_SHADOW, unitX, unitZ, 0.055);
      intensity = shadow + (1 - shadow) * key;
    } else {
      const wrapped = (ndl + u.wrap) / (1 + u.wrap);
      // Red and blue have much lower perceived luminance than orange. The old fixed intensity
      // range changed their RGB channels, but both faces still landed in one ASCII brightness
      // bucket. Lift and widen only darker saturated colors; orange keeps its already-readable
      // shading while red/blue gain distinct rear-face values without changing their hue.
      const baseLuminance = (vy.color.x * 0.299 + vy.color.y * 0.587 + vy.color.z * 0.114) / 255;
      const darkBoost = Math.max(0, Math.min(1, (DARK_COLOR_LUMINANCE - baseLuminance) / 0.18));
      const shadowBase = u.ambient + darkBoost * 0.04;
      const shadowRange = 0.065 + darkBoost * 0.075;
      const shadow = separatedShadow(shadowBase, unitX, unitZ, shadowRange);
      intensity = Math.max(shadow, wrapped);
    }
    PIECE_RGBA.r = vy.color.x * intensity;
    PIECE_RGBA.g = vy.color.y * intensity;
    PIECE_RGBA.b = vy.color.z * intensity;
    return PIECE_RGBA;
  },
};

const PIECE_RGBA = { r: 0, g: 0, b: 0, a: 1 };
