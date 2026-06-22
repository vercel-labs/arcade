import {
  cameraMatrices,
  type Camera,
  cube,
  lambertMaterial,
  mat4Multiply,
  mat4RotX,
  mat4RotY,
  normalize3,
  rasterize,
  type RenderTarget,
} from '../engine/index.ts';

const mesh = cube(1);
const camera: Camera = {
  eye: { x: 0, y: 0, z: 4.5 },
  target: { x: 0, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
  fovy: Math.PI / 3,
  near: 0.1,
  far: 100,
};
const light = normalize3({ x: -0.4, y: 0.7, z: 0.6 });

// Renders one frame of a rotating, lit cube through the full engine pipeline.
export function renderDemo(target: RenderTarget, t: number): void {
  target.clear(0, 0, 0);
  // Half-block pixels are ~square, so aspect is just width/height in pixels.
  const aspect = target.width / target.height;
  const { viewProjection } = cameraMatrices(camera, aspect);
  const model = mat4Multiply(mat4RotY(t * 0.6), mat4RotX(t * 0.35));
  const mvp = mat4Multiply(viewProjection, model);
  rasterize(target, mesh, lambertMaterial, { mvp, model, lightDir: light, ambient: 0.15 });
}
