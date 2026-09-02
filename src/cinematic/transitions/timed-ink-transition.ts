import type { Surface } from '../../engine/surface.ts';
import { anchoredInkMatchCut, type InkMatchCut } from './ink-match-cut.ts';

export interface TimedInkTransitionOptions {
  duration: number;
  cut: InkMatchCut;
}

/** Platform-neutral wall-clock controller for an authored Surface-to-Surface ink cut. */
export class TimedInkTransition {
  private elapsed = 0;
  private running = false;

  constructor(private readonly options: TimedInkTransitionOptions) {}

  start(): void { this.elapsed = 0; this.running = true; }
  cancel(): void { this.elapsed = 0; this.running = false; }
  active(): boolean { return this.running; }
  progress(): number { return this.running ? clamp01(this.elapsed / Math.max(0.001, this.options.duration)) : 0; }

  step(deltaSeconds: number): boolean {
    if (!this.running) return false;
    this.elapsed += Math.max(0, deltaSeconds);
    if (this.elapsed < this.options.duration) return false;
    this.elapsed = this.options.duration;
    return true;
  }

  compose(from: Surface, to: Surface, movingFrom: Surface | null = null): Surface {
    return anchoredInkMatchCut(from, to, from.cols, from.rows, ease(this.progress()), this.options.cut, null, movingFrom);
  }
}

function ease(value: number): number { const t = clamp01(value); return t * t * (3 - 2 * t); }
function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
