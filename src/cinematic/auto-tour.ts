export const LIVING_TITLE_TOUR_SECONDS = 42;

export function advanceAutoTourProgress(progress: number, elapsedSeconds: number, durationSeconds = LIVING_TITLE_TOUR_SECONDS): number {
  if (elapsedSeconds <= 0) return clamp01(progress);
  return clamp01(progress + elapsedSeconds / Math.max(1, durationSeconds));
}

export function interruptsAutoTourKey(key: string): boolean {
  return ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' ', 'Spacebar'].includes(key);
}

function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
