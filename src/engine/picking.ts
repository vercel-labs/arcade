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

export interface ProjectedSegmentDistance {
  distance: number;
  /** Closest position along the segment: 0 at start, 1 at end. */
  t: number;
}

export interface ProjectedShapeHit {
  distance: number;
  radius: number;
  /** Distance normalized by the projected radius; values <= 1 are inside the shape. */
  score: number;
}

export interface ViewportPoint {
  x: number;
  y: number;
}

/** Convert normalized projection coordinates into top-left-origin viewport coordinates. */
export function projectedPointToViewport(
  point: ProjectedPoint,
  width: number,
  height: number,
): ViewportPoint | null {
  if (point.behind) return null;
  return {
    x: (point.x * 0.5 + 0.5) * width,
    y: (1 - (point.y * 0.5 + 0.5)) * height,
  };
}

/**
 * Project a world-space polygon and return sqrt(screen-space area), a stable linear footprint
 * suitable for label-detail and level-of-detail thresholds.
 */
export function projectedPolygonFootprint(
  viewProjection: Mat4,
  points: readonly Vec3[],
  width: number,
  height: number,
): number {
  const projected: ViewportPoint[] = [];
  for (const point of points) {
    const viewport = projectedPointToViewport(projectPoint(viewProjection, point), width, height);
    if (!viewport) return 0;
    projected.push(viewport);
  }
  let twiceArea = 0;
  for (let index = 0; index < projected.length; index++) {
    const next = (index + 1) % projected.length;
    twiceArea += projected[index].x * projected[next].y - projected[next].x * projected[index].y;
  }
  return Math.sqrt(Math.abs(twiceArea) * 0.5);
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
): ProjectedShapeHit | null {
  const c = projectPoint(viewProjection, center);
  if (c.behind) return null;
  const edge = projectPoint(viewProjection, add3(center, radiusAxis));
  const radius = Math.hypot(edge.x - c.x, edge.y - c.y);
  const distance = Math.hypot(ndcX - c.x, ndcY - c.y);
  return distance < radius * padding
    ? { distance, radius, score: radius > 0 ? distance / radius : Infinity }
    : null;
}

/**
 * Screen-space distance from the cursor to a projected world-space segment.
 * `aspectCorrect` measures x and y in equal display units, which is useful for
 * terminal viewports whose normalized x axis covers a wider physical span.
 */
export function projectedSegmentDistance(
  viewProjection: Mat4,
  start: Vec3,
  end: Vec3,
  ndcX: number,
  ndcY: number,
  aspect = 1,
  aspectCorrect = false,
): ProjectedSegmentDistance | null {
  const a = projectPoint(viewProjection, start);
  const b = projectPoint(viewProjection, end);
  if (a.behind || b.behind) return null;
  const xScale = aspectCorrect ? aspect : 1;
  const ax = a.x * xScale;
  const ay = a.y;
  const bx = b.x * xScale;
  const by = b.y;
  const px = ndcX * xScale;
  const py = ndcY;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq > 1e-12
    ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq))
    : 0;
  return { distance: Math.hypot(px - (ax + dx * t), py - (ay + dy * t)), t };
}

/** Largest projected screen-space radius represented by one or more world-space offsets. */
function projectedMetricRadius(
  raycaster: Raycaster,
  center: Vec3,
  offsets: readonly Vec3[],
  minimum = 0,
): number {
  const projectedCenter = raycaster.project(center);
  if (projectedCenter.behind) return minimum;
  let radius = minimum;
  for (const offset of offsets) {
    const edge = raycaster.project(add3(center, offset));
    if (edge.behind) continue;
    radius = Math.max(
      radius,
      Math.hypot((edge.x - projectedCenter.x) * raycaster.aspect, edge.y - projectedCenter.y),
    );
  }
  return radius;
}

/**
 * Hit-test a projected world-space capsule. The segment follows the visible object's long axis;
 * radius offsets describe its constant screen-space thickness at the authored start endpoint.
 */
function projectedCapsuleHit(
  raycaster: Raycaster,
  start: Vec3,
  end: Vec3,
  radiusOffsets: readonly Vec3[],
  minimumRadius = 0,
): ProjectedShapeHit {
  const segment = raycaster.projectedSegmentDistance(start, end, true);
  // Treat thickness as constant across the projected segment, sampled at its authored start.
  // Besides matching the established Catan hit areas, this avoids a perspective-near endpoint
  // inflating the complete capsule into an overly grabby target at close camera distances.
  const radius = projectedMetricRadius(raycaster, start, radiusOffsets, minimumRadius);
  const distance = segment?.distance ?? Infinity;
  return { distance, radius, score: radius > 0 ? distance / radius : Infinity };
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

  projectedDisc(center: Vec3, radiusAxis: Vec3, padding = 1): ProjectedShapeHit | null {
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

  projectedSegmentDistance(start: Vec3, end: Vec3, aspectCorrect = false): ProjectedSegmentDistance | null {
    return projectedSegmentDistance(
      this.viewProjection,
      start,
      end,
      this.pointer.x,
      this.pointer.y,
      this.aspect,
      aspectCorrect,
    );
  }

  projectedCapsule(
    start: Vec3,
    end: Vec3,
    radiusOffsets: readonly Vec3[],
    minimumRadius = 0,
  ): ProjectedShapeHit {
    return projectedCapsuleHit(this, start, end, radiusOffsets, minimumRadius);
  }
}
