// The render-on-demand loop. The loop ticks at targetFps, but a tick only does
// render work when either (a) someone holds a "live" lease — a continuously
// animating screen (attract prism, dodge game, a running chess animation), or
// (b) a one-off render was requested (an interaction changed state). An idle
// screen (e.g. a static chess turntable) does no render or write work at all,
// while animations stay naturally capped at targetFps.
//
// This generalizes the old ad-hoc chess dirty-flag: instead of an always-on
// 30fps interval that re-renders + rewrites every frame, the app declares intent
// via requestLive()/dropLive() (sustained animation) and requestRender() (one
// frame), and the loop coalesces all writes for a frame into one stdout write.

export interface RendererOpts {
  targetFps?: number;
}

// Called once per rendered frame. `dt` is seconds since the last rendered frame.
export type FrameFn = (dt: number, now: number) => void;

export class Renderer {
  private readonly targetFps: number;
  private frameFn: FrameFn = () => {};
  private liveCount = 0;
  private renderPending = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private last = 0;
  private buf = '';

  constructor(opts: RendererOpts = {}) {
    this.targetFps = opts.targetFps ?? 30;
  }

  onFrame(fn: FrameFn): void {
    this.frameFn = fn;
  }

  start(): void {
    if (this.timer) return;
    this.last = Date.now();
    this.timer = setInterval(() => this.tick(), 1000 / this.targetFps);
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

  // Buffer output for the current frame; flushed in one write at frame end.
  write(s: string): void {
    this.buf += s;
  }

  private tick(): void {
    if (this.liveCount <= 0 && !this.renderPending) return;
    this.renderPending = false;
    const now = Date.now();
    const dt = (now - this.last) / 1000;
    this.last = now;
    this.buf = '';
    this.frameFn(dt, now);
    if (this.buf) {
      process.stdout.write(this.buf);
      this.buf = '';
    }
  }
}
