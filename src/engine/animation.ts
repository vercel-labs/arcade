import type { Vec3 } from './math.ts';

export type Easing = (t: number) => number;

export const linear: Easing = (t) => t;
export const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);
export const smoothstep: Easing = (value) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

/** Standard bounce-out easing, shared by drop/settle animations. */
export const bounceOut: Easing = (value) => {
  let t = value;
  const n = 7.5625;
  const d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
};

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

/** Converts absolute frame timestamps into a resettable elapsed clock. */
export class FrameClock {
  private lastTime: number | null = null;
  private elapsedTime = 0;

  reset(): void {
    this.lastTime = null;
    this.elapsedTime = 0;
  }

  tick(time: number): number {
    if (this.lastTime === null) {
      this.lastTime = time;
      return 0;
    }
    const dt = Math.max(0, time - this.lastTime);
    this.lastTime = time;
    this.elapsedTime += dt;
    return dt;
  }

  get elapsed(): number {
    return this.elapsedTime;
  }
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
