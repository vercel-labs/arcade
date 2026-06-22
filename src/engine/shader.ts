import type { Vec3, Vec4 } from './math.ts';

export interface RGBA {
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

/**
 * A material is a programmable shader pair plus pipeline state. This is the
 * single extension point for every visual style in the engine.
 */
export interface Material<U = unknown> {
  vertex(uniforms: U, vertex: VertexIn): Varying;
  /** Return the fragment's RGBA, or null to discard the pixel. */
  fragment(uniforms: U, varying: Varying): RGBA | null;
  blend?: BlendMode;
  cull?: CullMode;
}
