import type { Vec3 } from './math.ts';

export type Easing = (t: number) => number;

export const linear: Easing = (t) => t;
export const smoothstep: Easing = (t) => t * t * (3 - 2 * t);

export function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

/** Position along a straight segment with an optional parabolic world-Y lift. */
export function travelPoint(a: Vec3, b: Vec3, t: number, arcHeight = 0): Vec3 {
  const point = lerpVec3(a, b, t);
  if (arcHeight !== 0) point.y += arcHeight * 4 * t * (1 - t);
  return point;
}

export interface Animation {
  /** Advance by seconds. Return true while another frame is required. */
  update(dt: number): boolean;
}

export interface TweenOptions {
  duration: number;
  ease?: Easing;
  update(value: number): void;
  complete?: () => void;
}

export class Tween implements Animation {
  private elapsed = 0;
  private done = false;

  constructor(private readonly options: TweenOptions) {}

  update(dt: number): boolean {
    if (this.done) return false;
    const duration = Math.max(1e-9, this.options.duration);
    this.elapsed = Math.min(duration, this.elapsed + Math.max(0, dt));
    const progress = this.elapsed / duration;
    this.options.update((this.options.ease ?? linear)(progress));
    if (progress >= 1) {
      this.done = true;
      this.options.complete?.();
      return false;
    }
    return true;
  }
}

/** Small scheduler shared by scenes; custom animations only implement update(dt). */
export class AnimationScheduler {
  private active = new Set<Animation>();

  add(animation: Animation): Animation {
    this.active.add(animation);
    return animation;
  }

  remove(animation: Animation): void {
    this.active.delete(animation);
  }

  clear(): void {
    this.active.clear();
  }

  update(dt: number): boolean {
    for (const animation of [...this.active]) {
      if (!animation.update(dt)) this.active.delete(animation);
    }
    return this.active.size > 0;
  }

  get needsFrame(): boolean {
    return this.active.size > 0;
  }
}
