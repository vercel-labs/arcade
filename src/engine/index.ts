// Public API of the engine. App code (arcade/) imports from here;
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
export { cube, flatShade, meshBounds, quad, tetrahedron, TETRA_VERTS, TETRA_FACES, type AABB, type Mesh } from './mesh.ts';
export { parseObj, type ParseObjOptions } from './obj.ts';
export { cameraMatrices, type Camera, type CameraMatrices } from './camera.ts';
export { OrbitCamera, type OrbitCameraSnapshotOptions, type OrbitState } from './orbit.ts';
export {
  intersectRayPlane,
  projectPoint,
  projectedDiscHit,
  Raycaster,
  rayFromCamera,
  type ProjectedPoint,
  type Ray,
} from './picking.ts';
export {
  AnimationScheduler,
  FrameClock,
  SpringValue,
  Tween,
  bounceOut,
  clamp01,
  lerpVec3,
  linear,
  smoothstep,
  travelPoint,
  type Animation,
  type Easing,
  type SpringOptions,
  type TweenOptions,
} from './animation.ts';
export { GeometryBuilder, type VertexOptions } from './geometry.ts';
export { ResourceCache, type ResourceDisposer, type ResourceFactory } from './resources.ts';
export {
  BufferAttribute,
  BufferGeometry,
  type BoundingSphere,
  type BufferAttributeName,
  type UpdateRange,
} from './buffer-geometry.ts';
export {
  Group,
  InstancedMesh,
  MaterialInstance,
  MeshObject,
  Object3D,
  ObjectPool,
  Scene,
  SceneRenderer,
  type RenderContext,
  type UniformSource,
  type WorldUniforms,
  WorldMaterialInstance,
  type WorldMaterialValues,
  worldUniforms,
} from './scene.ts';
export {
  lambertMaterial,
  type LambertUniforms,
  feltMaterial,
  type FeltUniforms,
  waterMaterial,
  type WaterUniforms,
  glassMaterial,
  type GlassUniforms,
  pieceMaterial,
  type PieceUniforms,
  wispMaterial,
  type WispUniforms,
  coverMaterial,
  type CoverUniforms,
} from './materials.ts';
export { hslToRgb, lerpRgb, parseColor, blendOver, type RGB, type RGBA } from './color.ts';
export { decodePng, encodePng, sampleTexture, type Texture } from './texture.ts';
export { analyzeLogo, markCoverage, bakeMarkAlpha, backgroundRgb, type MarkAnalysis } from './logo-mark.ts';
export { cellWidth, stringWidth } from './width.ts';
export { FONT } from './font8x8.ts';
export {
  Surface,
  type Cell,
  STYLE_BOLD,
  STYLE_DIM,
  STYLE_UNDERLINE,
  STYLE_REVERSE,
} from './surface.ts';
export { applyTerminalColorMode, rgbToAnsi256, type TerminalColorMode } from './terminal-color.ts';
export { CellDiffer } from './diff.ts';
export { halfBlockToSurface, shapeGlyphToSurface, luminanceToSurface } from './present-cells.ts';
