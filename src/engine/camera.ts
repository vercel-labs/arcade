import { mat4LookAt, mat4Multiply, mat4Perspective, type Mat4, type Vec3 } from './math.ts';

export interface Camera {
  eye: Vec3;
  target: Vec3;
  up: Vec3;
  fovy: number;
  near: number;
  far: number;
  /** Horizontal film shift in normalized device coordinates, positive = right. */
  ndcOffsetX?: number;
  /** Vertical film shift in normalized device coordinates, positive = up. */
  ndcOffsetY?: number;
}

export interface CameraMatrices {
  view: Mat4;
  projection: Mat4;
  viewProjection: Mat4;
}

export function cameraMatrices(cam: Camera, aspect: number): CameraMatrices {
  const view = mat4LookAt(cam.eye, cam.target, cam.up);
  const projection = mat4Perspective(cam.fovy, aspect, cam.near, cam.far);
  if (cam.ndcOffsetX) projection[8] = -cam.ndcOffsetX;
  if (cam.ndcOffsetY) projection[9] = -cam.ndcOffsetY;
  return { view, projection, viewProjection: mat4Multiply(projection, view) };
}
