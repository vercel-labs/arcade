import type { Camera } from './camera.ts';
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
  behind: boolean;
}

/** Project a world point into normalized device coordinates. */
export function projectPoint(viewProjection: Mat4, point: Vec3): ProjectedPoint {
  const clip = mat4MulVec4(viewProjection, { ...point, w: 1 });
  const w = clip.w || 1e-4;
  return { x: clip.x / w, y: clip.y / w, z: clip.z / w, behind: clip.w <= 0 };
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
