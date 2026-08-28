import type { MouseEvent } from '../../platform/input.ts';

// SGR mouse input carries direction but no gesture magnitude. macOS terminals emit
// noticeably fewer horizontal reports for the same trackpad travel, so a continuing
// horizontal swipe gets a second cover step. The first report stays one-to-one, keeping
// a small deliberate nudge as precise as vertical scrolling.
const HORIZONTAL_REPEAT_WINDOW_MS = 240;
const HORIZONTAL_REPEAT_STEP = 2;

export class CoverFlowWheelInput {
  private lastHorizontalAt = -Infinity;
  private lastHorizontalDirection = 0;

  reset(): void {
    this.lastHorizontalAt = -Infinity;
    this.lastHorizontalDirection = 0;
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
    this.lastHorizontalAt = now;
    this.lastHorizontalDirection = direction;
    return direction * (continuingSwipe ? HORIZONTAL_REPEAT_STEP : 1);
  }
}
