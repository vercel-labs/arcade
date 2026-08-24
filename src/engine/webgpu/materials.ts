import type { CoverUniforms, FeltUniforms, GlassUniforms, LambertUniforms, PieceUniforms, WaterUniforms, WispUniforms } from '../materials.ts';
import type { WebGpuMaterial } from '../shader.ts';

const VERTEX_IO = /* wgsl */ `
struct VertexIn {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
  @location(3) color: vec3f,
};

struct VertexOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
  @location(3) color: vec3f,
};

fn webgpuClip(clip: vec4f) -> vec4f {
  return vec4f(clip.xy, (clip.z + clip.w) * 0.5, clip.w);
}
`;

const LAMBERT_WGSL = /* wgsl */ `
${VERTEX_IO}

struct Uniforms {
  mvp: mat4x4f,
  model: mat4x4f,
  lightAmbient: vec4f,
  wrap: vec4f,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

@vertex fn vertexMain(input: VertexIn) -> VertexOut {
  var out: VertexOut;
  out.clip = webgpuClip(u.mvp * vec4f(input.position, 1.0));
  out.world = input.position;
  out.normal = (u.model * vec4f(input.normal, 0.0)).xyz;
  out.uv = input.uv;
  out.color = input.color / 255.0;
  return out;
}

@fragment fn fragmentMain(input: VertexOut) -> @location(0) vec4f {
  let n = normalize(input.normal);
  let ndl = dot(n, u.lightAmbient.xyz);
  let wrap = u.wrap.x;
  let wrapped = select(ndl, (ndl + wrap) / (1.0 + wrap), wrap != 0.0);
  let intensity = max(u.lightAmbient.w, wrapped);
  return vec4f(input.color * intensity, 1.0);
}
`;

export const lambertWebGpuMaterial: WebGpuMaterial<LambertUniforms> = {
  wgsl: LAMBERT_WGSL,
  writeUniforms(out, uniforms) {
    out.set(uniforms.mvp, 0);
    out.set(uniforms.model, 16);
    out.set([uniforms.lightDir.x, uniforms.lightDir.y, uniforms.lightDir.z, uniforms.ambient], 32);
    out[36] = uniforms.wrap ?? 0;
  },
};

const FELT_WGSL = /* wgsl */ `
${VERTEX_IO}

struct Uniforms {
  mvp: mat4x4f,
  model: mat4x4f,
  lightAmbient: vec4f,
  stippleColorFrequency: vec4f,
  stippleShape: vec4f,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

fn feltHash(ix: i32, iz: i32) -> f32 {
  var h = bitcast<u32>(ix * 374761393 + iz * 668265263);
  h = bitcast<u32>(bitcast<i32>(h ^ (h >> 13u)) * 1274126177);
  h = h ^ (h >> 16u);
  return f32(h) / 4294967296.0;
}

@vertex fn vertexMain(input: VertexIn) -> VertexOut {
  var out: VertexOut;
  out.clip = webgpuClip(u.mvp * vec4f(input.position, 1.0));
  out.world = input.position;
  out.normal = (u.model * vec4f(input.normal, 0.0)).xyz;
  out.uv = input.uv;
  out.color = input.color / 255.0;
  return out;
}

@fragment fn fragmentMain(input: VertexOut) -> @location(0) vec4f {
  let intensity = max(u.lightAmbient.w, dot(normalize(input.normal), u.lightAmbient.xyz));
  var color = input.color * intensity;
  let lattice = input.world.xz * u.stippleColorFrequency.w;
  let cell = vec2i(floor(lattice));
  if (feltHash(cell.x, cell.y) < u.stippleShape.x) {
    let delta = fract(lattice) - vec2f(0.5);
    let radiusSquared = u.stippleShape.z * u.stippleShape.z;
    let distanceSquared = dot(delta, delta);
    if (distanceSquared < radiusSquared) {
      let gain = (1.0 - distanceSquared / radiusSquared) * u.stippleShape.y;
      color += (u.stippleColorFrequency.xyz / 255.0) * gain;
    }
  }
  return vec4f(color, 1.0);
}
`;

export const feltWebGpuMaterial: WebGpuMaterial<FeltUniforms> = {
  wgsl: FELT_WGSL,
  writeUniforms(out, uniforms) {
    out.set(uniforms.mvp, 0);
    out.set(uniforms.model, 16);
    out.set([uniforms.lightDir.x, uniforms.lightDir.y, uniforms.lightDir.z, uniforms.ambient], 32);
    out.set([uniforms.stipple.x, uniforms.stipple.y, uniforms.stipple.z, uniforms.stippleFreq], 36);
    out.set([uniforms.stippleDensity, uniforms.stippleGain, uniforms.stippleRadius, 0], 40);
  },
};

const PIECE_WGSL = /* wgsl */ `
${VERTEX_IO}

struct Uniforms {
  mvp: mat4x4f,
  model: mat4x4f,
  cameraAmbient: vec4f,
  keyStrength: vec4f,
  fillStrength: vec4f,
  tint: vec4f,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

@vertex fn vertexMain(input: VertexIn) -> VertexOut {
  let world = u.model * vec4f(input.position, 1.0);
  var out: VertexOut;
  out.clip = webgpuClip(u.mvp * vec4f(input.position, 1.0));
  out.world = world.xyz;
  out.normal = (u.model * vec4f(input.normal, 0.0)).xyz;
  out.uv = input.uv;
  out.color = u.tint.xyz / 255.0;
  return out;
}

@fragment fn fragmentMain(input: VertexOut) -> @location(0) vec4f {
  var n = normalize(input.normal);
  if (dot(n, u.cameraAmbient.xyz - input.world) < 0.0) { n = -n; }
  let key = u.keyStrength.w * max(0.0, dot(n, u.keyStrength.xyz));
  let fill = u.fillStrength.w * max(0.0, dot(n, u.fillStrength.xyz));
  let intensity = min(1.0, u.cameraAmbient.w + key + fill);
  return vec4f(input.color * intensity, 1.0);
}
`;

export const pieceWebGpuMaterial: WebGpuMaterial<PieceUniforms> = {
  wgsl: PIECE_WGSL,
  writeUniforms(out, uniforms) {
    out.set(uniforms.mvp, 0);
    out.set(uniforms.model, 16);
    out.set([uniforms.cameraPos.x, uniforms.cameraPos.y, uniforms.cameraPos.z, uniforms.ambient], 32);
    out.set([uniforms.keyDir.x, uniforms.keyDir.y, uniforms.keyDir.z, uniforms.keyStrength], 36);
    out.set([uniforms.fillDir.x, uniforms.fillDir.y, uniforms.fillDir.z, uniforms.fillStrength], 40);
    out.set([uniforms.tint.x, uniforms.tint.y, uniforms.tint.z, 0], 44);
  },
};

const GLASS_WGSL = /* wgsl */ `
${VERTEX_IO}

struct Uniforms {
  mvp: mat4x4f,
  model: mat4x4f,
  cameraEdgeWidth: vec4f,
  edgeBody: vec4f,
  glassAmbient: vec4f,
  optical: vec4f,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

@vertex fn vertexMain(input: VertexIn) -> VertexOut {
  let world = u.model * vec4f(input.position, 1.0);
  var out: VertexOut;
  out.clip = webgpuClip(u.mvp * vec4f(input.position, 1.0));
  out.world = world.xyz;
  out.normal = (u.model * vec4f(input.normal, 0.0)).xyz;
  out.uv = input.uv;
  out.color = input.color / 255.0;
  return out;
}

fn hueToRgb(h: f32) -> vec3f {
  let k = vec3f(0.0, 4.0, 2.0);
  return clamp(abs(fract(h + k / 6.0) * 6.0 - 3.0) - 1.0, vec3f(0.0), vec3f(1.0));
}

@fragment fn fragmentMain(input: VertexOut) -> @location(0) vec4f {
  let bary = vec3f(1.0 - input.uv.x - input.uv.y * 0.5, input.uv.x - input.uv.y * 0.5, input.uv.y);
  let edge = 1.0 - smoothstep(0.0, u.cameraEdgeWidth.w, min(bary.x, min(bary.y, bary.z)));
  let view = normalize(u.cameraEdgeWidth.xyz - input.world);
  let facing = abs(dot(normalize(input.normal), view));
  let fresnel = pow(1.0 - facing, u.optical.x);
  let body = u.edgeBody.w * (u.glassAmbient.w + (1.0 - u.glassAmbient.w) * fresnel);
  let hue = fract((input.world.y * 120.0 + input.world.x * 70.0 + 200.0) / 360.0);
  let dispersion = hueToRgb(hue) * 255.0 * u.optical.y * (0.35 + 0.65 * fresnel);
  let color = u.edgeBody.xyz * edge + u.glassAmbient.xyz * body + dispersion;
  return vec4f(color / 255.0, 1.0);
}
`;

export const glassWebGpuMaterial: WebGpuMaterial<GlassUniforms> = {
  wgsl: GLASS_WGSL,
  writeUniforms(out, uniforms) {
    out.set(uniforms.mvp, 0);
    out.set(uniforms.model, 16);
    out.set([uniforms.cameraPos.x, uniforms.cameraPos.y, uniforms.cameraPos.z, uniforms.edgeWidth], 32);
    out.set([uniforms.edgeColor.x, uniforms.edgeColor.y, uniforms.edgeColor.z, uniforms.bodyStrength], 36);
    out.set([uniforms.glassColor.x, uniforms.glassColor.y, uniforms.glassColor.z, uniforms.ambient], 40);
    out.set([uniforms.fresnelPower, uniforms.dispersion, 0, 0], 44);
  },
};

const WISP_WGSL = /* wgsl */ `
${VERTEX_IO}

struct Uniforms {
  mvp: mat4x4f,
  tintGain: vec4f,
  flicker: vec4f,
};
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var logo: texture_2d<f32>;
@group(0) @binding(2) var logoSampler: sampler;

@vertex fn vertexMain(input: VertexIn) -> VertexOut {
  var out: VertexOut;
  out.clip = webgpuClip(u.mvp * vec4f(input.position, 1.0));
  out.world = input.position;
  out.normal = input.normal;
  out.uv = input.uv;
  out.color = input.color / 255.0;
  return out;
}

@fragment fn fragmentMain(input: VertexOut) -> @location(0) vec4f {
  let mask = textureSample(logo, logoSampler, input.uv).a;
  if (mask <= 0.002) { discard; }
  return vec4f((u.tintGain.xyz / 255.0) * u.tintGain.w, min(1.0, mask * u.flicker.x));
}
`;

export const wispWebGpuMaterial: WebGpuMaterial<WispUniforms> = {
  wgsl: WISP_WGSL,
  writeUniforms(out, uniforms) {
    out.set(uniforms.mvp, 0);
    out.set([uniforms.tint.x, uniforms.tint.y, uniforms.tint.z, uniforms.gain], 16);
    out[20] = uniforms.flicker;
  },
  texture: (uniforms) => uniforms.logo,
};

const COVER_WGSL = /* wgsl */ `
${VERTEX_IO}

struct Uniforms {
  mvp: mat4x4f,
  model: mat4x4f,
  paperAmbient: vec4f,
  lightBrightness: vec4f,
  frameWidth: vec4f,
  fade: vec4f,
};
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var art: texture_2d<f32>;
@group(0) @binding(2) var artSampler: sampler;

@vertex fn vertexMain(input: VertexIn) -> VertexOut {
  let world = u.model * vec4f(input.position, 1.0);
  var out: VertexOut;
  out.clip = webgpuClip(u.mvp * vec4f(input.position, 1.0));
  out.world = world.xyz;
  out.normal = (u.model * vec4f(input.normal, 0.0)).xyz;
  out.uv = input.uv;
  out.color = input.color / 255.0;
  return out;
}

@fragment fn fragmentMain(input: VertexOut) -> @location(0) vec4f {
  let border = min(min(input.uv.x, 1.0 - input.uv.x), min(input.uv.y, 1.0 - input.uv.y));
  var color: vec3f;
  if (border < u.frameWidth.w) {
    color = u.frameWidth.xyz;
  } else {
    let inset = (input.uv - vec2f(u.fade.x)) / (1.0 - 2.0 * u.fade.x);
    if (any(inset < vec2f(0.0)) || any(inset > vec2f(1.0))) {
      color = u.paperAmbient.xyz;
    } else {
      let pixel = textureSampleLevel(art, artSampler, inset, 0.0);
      color = mix(u.paperAmbient.xyz / 255.0, pixel.rgb, pixel.a) * 255.0;
    }
  }
  let ndl = max(0.0, dot(normalize(input.normal), u.lightBrightness.xyz));
  var brightness = u.lightBrightness.w * (u.paperAmbient.w + (1.0 - u.paperAmbient.w) * ndl);
  if (u.fade.y != 0.0) {
    brightness *= clamp((input.world.y - u.fade.z) / (u.fade.w - u.fade.z), 0.0, 1.0);
  }
  return vec4f((color / 255.0) * brightness, 1.0);
}
`;

export const coverWebGpuMaterial: WebGpuMaterial<CoverUniforms> = {
  wgsl: COVER_WGSL,
  writeUniforms(out, uniforms) {
    out.set(uniforms.mvp, 0);
    out.set(uniforms.model, 16);
    out.set([uniforms.paper.x, uniforms.paper.y, uniforms.paper.z, uniforms.ambient], 32);
    out.set([uniforms.lightDir.x, uniforms.lightDir.y, uniforms.lightDir.z, uniforms.brightness], 36);
    out.set([uniforms.frameColor.x, uniforms.frameColor.y, uniforms.frameColor.z, uniforms.frameWidth], 40);
    out.set([uniforms.pad, uniforms.fade, uniforms.fadeY0, uniforms.fadeY1], 44);
  },
  texture: (uniforms) => uniforms.tex,
};

const WATER_WGSL = /* wgsl */ `
${VERTEX_IO}

struct Uniforms {
  mvp: mat4x4f,
  model: mat4x4f,
  timeFlow: vec4f,
  cameraPos: vec4f,
  sunDirection: vec4f,
  deepColor: vec4f,
  surfaceColor: vec4f,
  skyColor: vec4f,
  horizonColor: vec4f,
  currentColor: vec4f,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

fn waterHash(ix: i32, iz: i32) -> f32 {
  var h = (bitcast<u32>(ix) * 0x1f123bb5u) ^ (bitcast<u32>(iz) * 0x5f356495u);
  h = (h ^ (h >> 15u)) * 0x2c1b3c6du;
  h = h ^ (h >> 12u);
  return f32(h) / 4294967296.0;
}

fn waterNoise(p: vec2f) -> f32 {
  let cell = vec2i(floor(p));
  let f = fract(p);
  let s = f * f * (vec2f(3.0) - 2.0 * f);
  let a = waterHash(cell.x, cell.y);
  let b = waterHash(cell.x + 1, cell.y);
  let c = waterHash(cell.x, cell.y + 1);
  let d = waterHash(cell.x + 1, cell.y + 1);
  return mix(mix(a, b, s.x), mix(c, d, s.x), s.y);
}

fn geometryWave(x: f32, z: f32) -> vec3f {
  let time = u.timeFlow.x;
  let flowSpeed = u.timeFlow.y;
  let broad = waterNoise(vec2f(x * 0.095 + time * 0.008, z * 0.095 - time * 0.006)) - 0.5;
  let detail = waterNoise(vec2f(x * 0.29 - time * 0.011 + 5.7, z * 0.29 + time * 0.009 - 3.4)) - 0.5;
  let eddy = vec2f(x - 3.2, z + 4.1);
  let falloff = 1.0 / (1.0 + dot(eddy, eddy) * 0.07);
  let curl = vec2f(-eddy.y, eddy.x) * falloff;
  let p1 = x * 0.32 + z * 1.38 - time * flowSpeed * 0.55 + broad * 3.1 + detail * 1.3 + dot(curl, vec2f(0.32, 1.38)) * 0.24;
  let p2 = x * -0.74 + z * 1.92 - time * flowSpeed * 0.82 - broad * 2.2 + detail * 2.4 - dot(curl, vec2f(-0.74, 1.92)) * 0.18 + 2.1;
  let p3 = x * 1.46 + z * 0.68 - time * flowSpeed * 1.07 + broad * 1.4 - detail * 2.7 + dot(curl, vec2f(1.46, 0.68)) * 0.14 - 0.7;
  let c1 = cos(p1);
  let c2 = cos(p2);
  let c3 = cos(p3);
  return vec3f(
    sin(p1) * 0.032 + sin(p2) * 0.021 + sin(p3) * 0.013,
    c1 * 0.01024 - c2 * 0.01554 + c3 * 0.01898,
    c1 * 0.04416 + c2 * 0.04032 + c3 * 0.00884
  );
}

@vertex fn vertexMain(input: VertexIn) -> VertexOut {
  let wave = geometryWave(input.position.x, input.position.z);
  let position = input.position + vec3f(0.0, wave.x, 0.0);
  let world = u.model * vec4f(position, 1.0);
  var out: VertexOut;
  out.clip = webgpuClip(u.mvp * vec4f(position, 1.0));
  out.world = world.xyz;
  out.normal = (u.model * vec4f(-wave.y, 1.0, -wave.z, 0.0)).xyz;
  out.uv = input.uv;
  out.color = input.color / 255.0;
  return out;
}

@fragment fn fragmentMain(input: VertexOut) -> @location(0) vec4f {
  let x = input.world.x;
  let z = input.world.z;
  let time = u.timeFlow.x;
  let flowSpeed = u.timeFlow.y;
  let coarse = waterNoise(vec2f(x * 0.17 + time * 0.012, z * 0.17 - time * 0.009));
  let fine = waterNoise(vec2f(x * 0.83 - time * 0.031 + 11.7, z * 0.83 + time * 0.023 - 4.3));
  let warp = vec2f((coarse - 0.5) * 0.62 + (fine - 0.5) * 0.24, (coarse - 0.5) * -0.38 + (fine - 0.5) * 0.31);
  let eddy = vec2f(x + 4.6, z - 2.3);
  let falloff = 1.0 / (1.0 + dot(eddy, eddy) * 0.085);
  let curl = vec2f(-eddy.y, eddy.x) * falloff;
  let p1 = x * 1.4 + z * 10.4 - time * flowSpeed * 2.3 + warp.x * 7.2 + warp.y * 3.0 + dot(curl, vec2f(1.4, 10.4)) * 0.11;
  let p2 = x * -8.8 + z * 7.9 - time * flowSpeed * 2.9 - warp.x * 5.1 + warp.y * 6.3 + dot(curl, vec2f(-8.8, 7.9)) * -0.085 + 1.7;
  let p3 = x * 12.6 - z * 6.7 - time * flowSpeed * 3.7 + (fine - 0.5) * 6.6 + (coarse - 0.5) * 3.2 + dot(curl, vec2f(12.6, -6.7)) * 0.065 - 0.6;
  let phases = cos(vec3f(p1, p2, p3));

  let toEye = u.cameraPos.xyz - input.world;
  let viewDistance = length(toEye);
  let detailLod = clamp((22.0 - viewDistance) / 12.0, 0.12, 1.0);
  let fineGradient = vec2f(
    phases.x * 0.0112 - phases.y * 0.0792 + phases.z * 0.0756,
    phases.x * 0.0832 + phases.y * 0.0711 - phases.z * 0.0402
  ) * detailLod;
  let n = normalize(input.normal - vec3f(fineGradient.x * 1.35, 0.0, fineGradient.y * 1.35));
  let view = normalize(toEye);
  let halfVector = normalize(view + u.sunDirection.xyz);
  let reflectionFacing = max(0.0, dot(n, halfVector));
  let softReflection = smoothstep(0.78, 0.9, reflectionFacing);
  let sharpReflection = smoothstep(0.87, 0.97, reflectionFacing);
  let reflectionNoise = coarse * 0.38 + fine * 0.62;
  let interference = 0.5 + phases.x * 0.18 + phases.y * 0.13 + phases.z * 0.1;
  let microPatch = smoothstep(0.46, 0.7, interference);
  let rippleCrest = 0.5 + phases.x * 0.22 + phases.y * 0.18 + phases.z * 0.1;
  let diffuseCrest = smoothstep(0.56, 0.88, rippleCrest) * (0.25 + fine * 0.75) * detailLod;
  let glintPatch = smoothstep(0.32, 0.74, reflectionNoise) * (0.04 + smoothstep(0.36, 0.72, fine) * 0.48 + microPatch * 0.48);
  let reflection = min(1.0, (softReflection * 0.16 + sharpReflection * 0.84) * (0.08 + glintPatch * 0.92));

  let viewFacing = max(0.0, dot(n, view));
  let fresnel = 0.04 + 0.96 * pow(1.0 - viewFacing, 5.0);
  let reflectedY = -view.y + 2.0 * viewFacing * n.y;
  let horizonBand = 1.0 - smoothstep(0.012, 0.2, abs(reflectedY));
  let skyUp = smoothstep(-0.08, 0.82, reflectedY);
  let brokenHorizon = horizonBand * (0.16 + glintPatch * 0.58 + microPatch * 0.26);
  let environmentBase = mix(u.deepColor.xyz, u.skyColor.xyz, 0.34 + skyUp * 0.66);
  let environment = mix(environmentBase, u.horizonColor.xyz, brokenHorizon * (0.72 + glintPatch * 0.28));
  let sunFacing = max(0.0, dot(n, u.sunDirection.xyz));
  let broadSkyA = smoothstep(0.84, 0.98, dot(n, normalize(vec3f(-0.28, 0.93, 0.24)))) * (0.5 + glintPatch * 0.5);
  let broadSkyB = smoothstep(0.855, 0.982, dot(n, normalize(vec3f(0.36, 0.91, -0.18)))) * (0.46 + microPatch * 0.54);
  let broadSky = min(1.0, broadSkyA * 0.58 + broadSkyB * 0.42);
  let baseMix = clamp(0.4 + (coarse - 0.5) * 0.16 + (fine - 0.5) * 0.18 + (rippleCrest - 0.5) * 0.28 + microPatch * 0.045 + fresnel * 0.1 + (sunFacing - 0.72) * 0.2, 0.0, 1.0);
  let base = mix(u.deepColor.xyz, u.surfaceColor.xyz, baseMix);
  let environmentMix = min(0.66, 0.115 + fresnel * 0.4 + broadSky * 0.22 + brokenHorizon * 0.06 + (1.0 - detailLod) * fresnel * 0.04);
  let reflected = mix(base, environment, environmentMix);
  let crest = mix(reflected, u.skyColor.xyz, diffuseCrest * 0.28);
  let color = mix(crest, u.currentColor.xyz, reflection * (0.44 + fresnel * 0.34));
  return vec4f(color / 255.0, 1.0);
}
`;

export const waterWebGpuMaterial: WebGpuMaterial<WaterUniforms> = {
  wgsl: WATER_WGSL,
  writeUniforms(out, uniforms) {
    out.set(uniforms.mvp, 0);
    out.set(uniforms.model, 16);
    out.set([uniforms.time, uniforms.flowSpeed, 0, 0], 32);
    out.set([uniforms.cameraPos.x, uniforms.cameraPos.y, uniforms.cameraPos.z, 0], 36);
    out.set([uniforms.sunDirection.x, uniforms.sunDirection.y, uniforms.sunDirection.z, 0], 40);
    out.set([uniforms.deepColor.x, uniforms.deepColor.y, uniforms.deepColor.z, 0], 44);
    out.set([uniforms.surfaceColor.x, uniforms.surfaceColor.y, uniforms.surfaceColor.z, 0], 48);
    out.set([uniforms.skyColor.x, uniforms.skyColor.y, uniforms.skyColor.z, 0], 52);
    out.set([uniforms.horizonColor.x, uniforms.horizonColor.y, uniforms.horizonColor.z, 0], 56);
    out.set([uniforms.currentColor.x, uniforms.currentColor.y, uniforms.currentColor.z, 0], 60);
  },
};
