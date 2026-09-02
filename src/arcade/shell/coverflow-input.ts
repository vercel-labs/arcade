import type { MouseEvent } from '../../platform/input.ts';

// SGR mouse input carries only axis and direction, not gesture magnitude. Keep
// the first report one-to-one, then use report cadence as a restrained proxy
// for a fling. A short axis lock filters the perpendicular noise emitted by
// diagonal trackpad gestures without preventing a deliberate later axis change.
const GESTURE_WINDOW_MS = 240;
const AXIS_LOCK_MS = 180;
const HORIZONTAL_MAX_STEP = 2;

export class CoverFlowWheelInput {
  private lastAt = -Infinity;
  private axis: 'vertical' | 'horizontal' | null = null;
  private direction = 0;
  private run = 0;

  reset(): void {
    this.lastAt = -Infinity;
    this.axis = null;
    this.direction = 0;
    this.run = 0;
  }

  step(e: Pick<MouseEvent, 'wheel' | 'wheelAxis'>, now = performance.now()): number {
    const direction = e.wheel === -1 ? -1 : 1;
    const axis = e.wheelAxis === 'horizontal' ? 'horizontal' : 'vertical';
    if (this.axis !== null && axis !== this.axis && now - this.lastAt <= AXIS_LOCK_MS) {
      return 0;
    }

    const continuing = axis === this.axis && direction === this.direction && now - this.lastAt <= GESTURE_WINDOW_MS;
    this.run = continuing ? this.run + 1 : 1;
    this.lastAt = now;
    this.axis = axis;
    this.direction = direction;

    if (axis === 'vertical') return this.run % 2 === 0 ? 0 : direction;
    return direction * Math.min(HORIZONTAL_MAX_STEP, Math.ceil(this.run / 2));
  }
}
