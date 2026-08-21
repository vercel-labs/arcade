import type { Vec3, Vec4 } from './math.ts';

// A fragment-shader color: object form, rgb 0..255, alpha 0..1. Distinct from
// color.ts's tuple `RGBA` (the public surface/texture color type) — named RGBA8
// so the engine barrel doesn't collide on the name `RGBA`.
export interface RGBA8 {
  r: number; // 0..255
  g: number;
  b: number;
  a: number; // 0..1
}

/** A single input vertex. `color` is a base RGB (0..255) carried per-vertex. */
export interface VertexIn {
  position: Vec3;
  normal: Vec3;
  uv: [number, number];
  color: Vec3;
}

/**
 * Per-vertex output of the vertex program, interpolated across the triangle
 * before the fragment program runs. `clip` is clip-space position; the rest are
 * interpolated perspective-correctly.
 */
export interface Varying {
  clip: Vec4;
  world: Vec3;
  normal: Vec3;
  uv: [number, number];
  color: Vec3;
  /** Barycentric weights, filled by the rasterizer. Useful for edge/wireframe shaders. */
  bary: Vec3;
}

export type BlendMode = 'opaque' | 'add' | 'alpha';
export type CullMode = 'back' | 'front' | 'none';

/** GPU implementation of one material. Kept data-only so the CPU engine has no native dependency. */
export interface WebGpuMaterial<U> {
  readonly wgsl: string;
  /** Write this draw's uniforms into the shared 256-byte dynamic-uniform slot. */
  writeUniforms(target: Float32Array, uniforms: U): void;
}

/**
 * A material is a programmable shader pair plus pipeline state. This is the
 * single extension point for every visual style in the engine.
 */
export interface Material<U = unknown> {
  vertex(uniforms: U, vertex: VertexIn): Varying;
  /** Return the fragment's color, or null to discard the pixel. */
  fragment(uniforms: U, varying: Varying): RGBA8 | null;
  blend?: BlendMode;
  cull?: CullMode;
  /** Optional WGSL implementation used by the opt-in Node WebGPU backend. */
  webgpu?: WebGpuMaterial<U>;
}
