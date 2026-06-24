// Public API of the engine. App code (arcade/, demo/) imports from here;
// modules inside the engine import each other directly to avoid cycles.
export * from './math.ts';
export * from './shader.ts';
export { RenderTarget } from './framebuffer.ts';
export { rasterize } from './raster.ts';
export {
  toHalfBlock,
  toShapeGlyph,
  type ShapeGlyphOptions,
  toLuminance,
  type LuminanceOptions,
} from './present.ts';
export { downsample } from './supersample.ts';
export { bloom, type BloomOptions } from './bloom.ts';
export { cube, flatShade, meshBounds, tetrahedron, TETRA_VERTS, TETRA_FACES, type AABB, type Mesh } from './mesh.ts';
export { parseObj, type ParseObjOptions } from './obj.ts';
export { cameraMatrices, type Camera, type CameraMatrices } from './camera.ts';
export {
  lambertMaterial,
  type LambertUniforms,
  glassMaterial,
  type GlassUniforms,
  pieceMaterial,
  type PieceUniforms,
} from './materials.ts';
export { hslToRgb, lerpRgb, parseColor, blendOver, type RGB, type RGBA } from './color.ts';
export { cellWidth, stringWidth } from './width.ts';
export {
  Surface,
  type Cell,
  STYLE_BOLD,
  STYLE_DIM,
  STYLE_UNDERLINE,
  STYLE_REVERSE,
} from './surface.ts';
