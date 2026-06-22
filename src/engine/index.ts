// Public API of the engine. App code (arcade/, demo/) imports from here;
// modules inside the engine import each other directly to avoid cycles.
export * from './math.ts';
export * from './shader.ts';
export { RenderTarget } from './framebuffer.ts';
export { rasterize } from './raster.ts';
export { toHalfBlock } from './present.ts';
export { downsample } from './supersample.ts';
export { cube, type Mesh } from './mesh.ts';
export { cameraMatrices, type Camera, type CameraMatrices } from './camera.ts';
export { lambertMaterial, type LambertUniforms } from './materials.ts';
export { hslToRgb, lerpRgb, type RGB } from './color.ts';
