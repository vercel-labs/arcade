import { TERMINAL_CELL_ASPECT_RATIO } from './canvas-surface-host.ts';

export const CINEMATIC_CELL_HEIGHT = 12;
export const MOBILE_CINEMATIC_CELL_HEIGHT = 10;
const MID_SCREEN_CELL_HEIGHT = 14;
const MID_SCREEN_MIN_WIDTH = 1500;
const LARGE_SCREEN_CELL_HEIGHT = 18;
const LARGE_SCREEN_MIN_WIDTH = 1800;
const LARGE_SCREEN_MIN_HEIGHT = 900;

/**
 * Terminal resize semantics for the browser host: cell size stays fixed within
 * each density tier and the viewport gains or loses columns/rows. Four tiers:
 * mobile ≤760px → 10px, mid ≥1500×900 → 14px, large ≥1800×900 → 18px, else 12px.
 * Using one cell height for both axes guarantees the scene camera aspect matches
 * the visible canvas aspect.
 */
export function responsiveTerminalGrid(
  width: number,
  height: number,
  cellHeight = width <= 760
    ? MOBILE_CINEMATIC_CELL_HEIGHT
    : width >= LARGE_SCREEN_MIN_WIDTH && height >= LARGE_SCREEN_MIN_HEIGHT
      ? LARGE_SCREEN_CELL_HEIGHT
      : width >= MID_SCREEN_MIN_WIDTH && height >= LARGE_SCREEN_MIN_HEIGHT
        ? MID_SCREEN_CELL_HEIGHT
        : CINEMATIC_CELL_HEIGHT,
): { cols: number; rows: number } {
  const safeHeight = Math.max(8, cellHeight);
  return {
    cols: Math.max(40, Math.floor(width / (safeHeight * TERMINAL_CELL_ASPECT_RATIO))),
    rows: Math.max(24, Math.floor(height / safeHeight)),
  };
}
