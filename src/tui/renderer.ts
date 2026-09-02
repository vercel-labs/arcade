// The adaptive render-on-demand loop. A 60 Hz heartbeat serves inexpensive scenes at full
// cadence and skips alternate beats for expensive scenes; a tick only does
// render work when either (a) someone holds a "live" lease — a continuously
// animating screen (the prism, a running chess animation), or
// (b) a one-off render was requested (an interaction changed state). An idle
// screen (e.g. a static chess turntable) does no render or write work at all,
// while animations stay naturally capped at targetFps.
//
// This generalizes the old ad-hoc chess dirty-flag: instead of an always-on
// 30fps interval that re-renders + rewrites every frame, the app declares intent
// via requestLive()/dropLive() (sustained animation) and requestRender() (one
// frame), and the loop coalesces all writes for a frame into one stdout write.

export interface RendererOpts {
  /** Fast cadence used while recent frame work fits comfortably inside its budget. */
  maxFps?: number;
  /** Stable fallback cadence for scenes whose recent p95 exceeds the fast-frame budget. */
  minFps?: number;
  /** Maximum recent p95 that may remain/promote at maxFps. */
  fastFrameBudgetMs?: number;
  /** Number of measured frames used for the rolling p95 and promotion hysteresis. */
  sampleWindow?: number;
  /** Short overload window used to demote quickly without making promotion oscillate. */
  overloadWindow?: number;
  /** Compatibility alias: fixes maxFps=minFps to one non-adaptive cadence. */
  targetFps?: number;
  /** Injectable writable/clock used by deterministic scheduler tests. */
  output?: RendererOutput;
  now?: () => number;
}

export interface RendererOutput {
  write(value: string): boolean;
  once(event: 'drain', listener: () => void): unknown;
}

// Called once per rendered frame. `dt` is seconds since the last rendered frame.
export type FrameFn = (dt: number, now: number) => void;

export class Renderer {
  private readonly maxFps: number;
  private readonly minFps: number;
  private readonly fastFrameBudgetMs: number;
  private readonly sampleWindow: number;
  private readonly overloadWindow: number;
  private readonly output: RendererOutput;
  private readonly now: () => number;
  private frameFn: FrameFn = () => {};
  private liveCount = 0;
  private renderPending = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private last = 0;
  private lastFrameAt = -Infinity;
  private buf = '';
  private blocked = false;
  private cadence: 'fast' | 'steady' = 'fast';
  private samples: number[] = [];
  private readonly onDrain = (): void => {
    this.blocked = false;
    // Requests are a single latest-state bit, never a queue. A one-off interaction that arrived
    // while blocked paints immediately; a live animation likewise catches up from wall clock.
    if (this.renderPending || this.liveCount > 0) this.tick(true);
  };

  constructor(opts: RendererOpts = {}) {
    const fixed = opts.targetFps;
    this.maxFps = fixed ?? opts.maxFps ?? 60;
    this.minFps = fixed ?? opts.minFps ?? 30;
    if (this.maxFps <= 0 || this.minFps <= 0 || this.minFps > this.maxFps) throw new RangeError('Renderer FPS bounds are invalid');
    this.fastFrameBudgetMs = opts.fastFrameBudgetMs ?? 13;
    this.sampleWindow = Math.max(4, Math.floor(opts.sampleWindow ?? 30));
    this.overloadWindow = Math.max(3, Math.min(this.sampleWindow, Math.floor(opts.overloadWindow ?? 6)));
    this.output = opts.output ?? process.stdout;
    this.now = opts.now ?? (() => performance.now());
  }

  onFrame(fn: FrameFn): void {
    this.frameFn = fn;
  }

  start(): void {
    if (this.timer) return;
    this.last = this.now();
    this.timer = setInterval(() => this.tick(), 1000 / this.maxFps);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  destroy(): void {
    this.stop();
  }

  // Schedule one render on the next tick (an interaction changed something).
  requestRender(): void {
    this.renderPending = true;
  }

  // Acquire/release a sustained-animation lease. While any are held, every tick
  // renders. Counted, so independent animators compose (the loop stays live
  // until all leases drop).
  requestLive(): void {
    this.liveCount++;
  }

  dropLive(): void {
    if (this.liveCount > 0) this.liveCount--;
  }

  get isLive(): boolean {
    return this.liveCount > 0;
  }

  get activeFps(): number {
    return this.cadence === 'fast' ? this.maxFps : this.minFps;
  }

  // Buffer output for the current frame; flushed in one write at frame end.
  write(s: string): void {
    this.buf += s;
  }

  /** One heartbeat. Public so deterministic hosts/tests can drive the scheduler without timers. */
  tick(force = false): void {
    if (this.blocked || (this.liveCount <= 0 && !this.renderPending)) return;
    const startedAt = this.now();
    const interval = 1000 / this.activeFps;
    if (!force && startedAt - this.lastFrameAt + 0.25 < interval) return;
    this.renderPending = false;
    const dt = (startedAt - this.last) / 1000;
    this.last = startedAt;
    this.lastFrameAt = startedAt;
    this.buf = '';
    this.frameFn(dt, startedAt);
    this.recordFrameDuration(this.now() - startedAt);
    if (this.buf) {
      const accepted = this.output.write(this.buf);
      this.buf = '';
      if (!accepted) {
        this.blocked = true;
        this.output.once('drain', this.onDrain);
      }
    }
  }

  private recordFrameDuration(durationMs: number): void {
    this.samples.push(durationMs);
    if (this.samples.length > this.sampleWindow) this.samples.shift();
    const required = this.cadence === 'fast' ? this.overloadWindow : this.sampleWindow;
    if (this.samples.length < required) return;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    if (this.cadence === 'fast' && p95 > this.fastFrameBudgetMs) {
      this.cadence = 'steady';
      this.samples = [];
    } else if (this.cadence === 'steady' && p95 <= this.fastFrameBudgetMs) {
      this.cadence = 'fast';
      this.samples = [];
    }
  }
}
