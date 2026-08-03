import { cameraMatrices, type Camera } from './camera.ts';
import {
  add3,
  cross3,
  dot3,
  mat4MulVec4,
  normalize3,
  scale3,
  sub3,
  type Mat4,
  type Vec3,
} from './math.ts';

export interface Ray {
  origin: Vec3;
  direction: Vec3;
}

/** Build a world-space ray through a normalized-device-coordinate cursor. */
export function rayFromCamera(camera: Camera, ndcX: number, ndcY: number, aspect: number): Ray {
  const forward = normalize3(sub3(camera.target, camera.eye));
  const right = normalize3(cross3(forward, camera.up));
  const up = cross3(right, forward);
  const tanHalf = Math.tan(camera.fovy / 2);
  return {
    origin: { ...camera.eye },
    direction: normalize3(
      add3(forward, add3(scale3(right, ndcX * tanHalf * aspect), scale3(up, ndcY * tanHalf))),
    ),
  };
}

/** Intersect a ray with a plane defined by dot(normal, point) = constant. */
export function intersectRayPlane(ray: Ray, normal: Vec3, constant = 0): Vec3 | null {
  const denominator = dot3(normal, ray.direction);
  if (Math.abs(denominator) < 1e-6) return null;
  const distance = (constant - dot3(normal, ray.origin)) / denominator;
  if (distance <= 0) return null;
  return add3(ray.origin, scale3(ray.direction, distance));
}

export interface ProjectedPoint {
  x: number;
  y: number;
  z: number;
  clipW: number;
  behind: boolean;
}

/** Project a world point into normalized device coordinates. */
export function projectPoint(viewProjection: Mat4, point: Vec3): ProjectedPoint {
  const clip = mat4MulVec4(viewProjection, { ...point, w: 1 });
  const w = clip.w || 1e-4;
  return { x: clip.x / w, y: clip.y / w, z: clip.z / w, clipW: clip.w, behind: clip.w <= 0 };
}

/** Cursor hit against a projected world-space disc/billboard radius. */
export function projectedDiscHit(
  viewProjection: Mat4,
  center: Vec3,
  radiusAxis: Vec3,
  ndcX: number,
  ndcY: number,
  padding = 1,
): { distance: number; radius: number } | null {
  const c = projectPoint(viewProjection, center);
  if (c.behind) return null;
  const edge = projectPoint(viewProjection, add3(center, radiusAxis));
  const radius = Math.hypot(edge.x - c.x, edge.y - c.y);
  const distance = Math.hypot(ndcX - c.x, ndcY - c.y);
  return distance < radius * padding ? { distance, radius } : null;
}

/**
 * Retained camera/pointer query state, mirroring Three.js's Raycaster authoring
 * model while supporting the projected hit shapes terminal games commonly use.
 */
export class Raycaster {
  ray: Ray = { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: -1 } };
  viewProjection: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  readonly pointer = { x: 0, y: 0 };
  aspect = 1;

  setFromCamera(camera: Camera, ndcX: number, ndcY: number, aspect: number): this {
    this.ray = rayFromCamera(camera, ndcX, ndcY, aspect);
    this.viewProjection = cameraMatrices(camera, aspect).viewProjection;
    this.pointer.x = ndcX;
    this.pointer.y = ndcY;
    this.aspect = aspect;
    return this;
  }

  intersectPlane(normal: Vec3, constant = 0): Vec3 | null {
    return intersectRayPlane(this.ray, normal, constant);
  }

  project(point: Vec3): ProjectedPoint {
    return projectPoint(this.viewProjection, point);
  }

  projectedDisc(center: Vec3, radiusAxis: Vec3, padding = 1): { distance: number; radius: number } | null {
    return projectedDiscHit(
      this.viewProjection,
      center,
      radiusAxis,
      this.pointer.x,
      this.pointer.y,
      padding,
    );
  }

  projectedDistance(point: Vec3, aspectCorrect = false): number {
    const projected = this.project(point);
    if (projected.clipW <= 1e-4) return Infinity;
    const dx = projected.x - this.pointer.x;
    const dy = projected.y - this.pointer.y;
    return Math.hypot(aspectCorrect ? dx * this.aspect : dx, dy);
  }
}
