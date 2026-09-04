import { TERMINAL_CELL_ASPECT_RATIO } from './canvas-surface-host.ts';

export const CINEMATIC_CELL_HEIGHT = 12;
export const MOBILE_CINEMATIC_CELL_HEIGHT = 10;
const LARGE_SCREEN_CELL_HEIGHT = 14;
const LARGE_SCREEN_MIN_WIDTH = 1800;
const LARGE_SCREEN_MIN_HEIGHT = 900;

/**
 * Terminal resize semantics for the browser host: cell size stays fixed within
 * each density tier and the viewport gains or loses columns/rows. Large monitors
 * step up once for readability and lower render cost. Using one cell height for
 * both axes guarantees the scene camera aspect matches the visible canvas aspect.
 */
export function responsiveTerminalGrid(
  width: number,
  height: number,
  cellHeight = width >= LARGE_SCREEN_MIN_WIDTH && height >= LARGE_SCREEN_MIN_HEIGHT
    ? LARGE_SCREEN_CELL_HEIGHT
    : CINEMATIC_CELL_HEIGHT,
): { cols: number; rows: number } {
  const safeHeight = Math.max(8, cellHeight);
  return {
    cols: Math.max(40, Math.floor(width / (safeHeight * TERMINAL_CELL_ASPECT_RATIO))),
    rows: Math.max(24, Math.floor(height / safeHeight)),
  };
}
