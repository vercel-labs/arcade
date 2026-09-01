import type { MouseEvent } from '../../platform/input.ts';

// SGR mouse input carries direction but no gesture magnitude. macOS terminals emit
// noticeably fewer horizontal reports for the same trackpad travel, so report cadence
// is the only available proxy for a horizontal fling. Repeated reports accelerate from
// 1 -> 2 -> 3 -> 4 covers; the first report remains one-to-one for precise nudges.
const HORIZONTAL_REPEAT_WINDOW_MS = 240;
const HORIZONTAL_MAX_STEP = 4;

export class CoverFlowWheelInput {
  private lastHorizontalAt = -Infinity;
  private lastHorizontalDirection = 0;
  private horizontalRun = 0;

  reset(): void {
    this.lastHorizontalAt = -Infinity;
    this.lastHorizontalDirection = 0;
    this.horizontalRun = 0;
  }

  step(e: Pick<MouseEvent, 'wheel' | 'wheelAxis'>, now = performance.now()): number {
    const direction = e.wheel === -1 ? -1 : 1;
    if (e.wheelAxis !== 'horizontal') {
      this.reset();
      return direction;
    }

    const continuingSwipe =
      direction === this.lastHorizontalDirection &&
      now - this.lastHorizontalAt <= HORIZONTAL_REPEAT_WINDOW_MS;
    this.horizontalRun = continuingSwipe ? Math.min(HORIZONTAL_MAX_STEP, this.horizontalRun + 1) : 1;
    this.lastHorizontalAt = now;
    this.lastHorizontalDirection = direction;
    return direction * this.horizontalRun;
  }
}
