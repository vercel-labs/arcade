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

export interface SpringOptions {
  value?: number;
  target?: number;
  stiffness?: number;
  damping?: number;
  mass?: number;
  min?: number;
  max?: number;
  maxStep?: number;
  epsilon?: number;
}

/** Stable fixed-substep scalar spring for interactive, interruptible motion. */
export class SpringValue implements Animation {
  value: number;
  velocity = 0;
  target: number;
  readonly stiffness: number;
  readonly damping: number;
  readonly mass: number;
  readonly min: number;
  readonly max: number;
  readonly maxStep: number;
  readonly epsilon: number;

  constructor(options: SpringOptions = {}) {
    this.value = options.value ?? 0;
    this.target = options.target ?? this.value;
    this.stiffness = options.stiffness ?? 170;
    this.damping = options.damping ?? 26;
    this.mass = Math.max(1e-9, options.mass ?? 1);
    this.min = options.min ?? -Infinity;
    this.max = options.max ?? Infinity;
    this.maxStep = Math.max(1e-6, options.maxStep ?? 0.02);
    this.epsilon = Math.max(0, options.epsilon ?? 0.001);
  }

  setTarget(target: number): this {
    this.target = target;
    return this;
  }

  snap(value: number): this {
    this.value = value;
    this.target = value;
    this.velocity = 0;
    return this;
  }

  update(dt: number): boolean {
    const elapsed = Math.max(0, dt);
    const steps = Math.max(1, Math.ceil(elapsed / this.maxStep));
    const h = elapsed / steps;
    for (let step = 0; step < steps; step++) {
      const acceleration = (this.stiffness * (this.target - this.value) - this.damping * this.velocity) / this.mass;
      this.velocity += acceleration * h;
      this.value += this.velocity * h;
      if (this.value < this.min) {
        this.value = this.min;
        if (this.velocity < 0) this.velocity = 0;
      } else if (this.value > this.max) {
        this.value = this.max;
        if (this.velocity > 0) this.velocity = 0;
      }
    }
    return !this.settled;
  }

  get settled(): boolean {
    return Math.abs(this.value - this.target) <= this.epsilon && Math.abs(this.velocity) <= this.epsilon;
  }
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
