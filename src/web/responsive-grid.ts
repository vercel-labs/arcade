import { TERMINAL_CELL_ASPECT_RATIO } from './canvas-surface-host.ts';

export const CINEMATIC_CELL_HEIGHT = 12;

/**
 * Terminal resize semantics for the browser host: the cell size stays fixed and
 * the viewport gains or loses columns/rows. Using one cell height for both axes
 * guarantees the scene camera aspect matches the visible canvas aspect.
 */
export function responsiveTerminalGrid(width: number, height: number, cellHeight = CINEMATIC_CELL_HEIGHT): { cols: number; rows: number } {
  const safeHeight = Math.max(8, cellHeight);
  return {
    cols: Math.max(40, Math.floor(width / (safeHeight * TERMINAL_CELL_ASPECT_RATIO))),
    rows: Math.max(24, Math.floor(height / safeHeight)),
  };
}
