export interface TerminalTouchGrid {
  left: number;
  top: number;
  width: number;
  height: number;
  cols: number;
  rows: number;
}

export function terminalCell(clientX: number, clientY: number, grid: TerminalTouchGrid): { x: number; y: number } {
  return {
    x: clamp(Math.floor(((clientX - grid.left) / Math.max(1, grid.width)) * grid.cols) + 1, 1, grid.cols),
    y: clamp(Math.floor(((clientY - grid.top) / Math.max(1, grid.height)) * grid.rows) + 1, 1, grid.rows),
  };
}

/** SGR mouse protocol—the same bytes emitted by a desktop terminal. */
export function sgrMouse(kind: 'left-down' | 'left-drag' | 'left-up' | 'right-down' | 'right-up' | 'wheel-up' | 'wheel-down', x: number, y: number): string {
  const code = kind === 'left-down' || kind === 'left-up' ? 0
    : kind === 'left-drag' ? 32
      : kind === 'right-down' || kind === 'right-up' ? 2
        : kind === 'wheel-up' ? 64 : 65;
  const release = kind === 'left-up' || kind === 'right-up' ? 'm' : 'M';
  return `\x1b[<${code};${x};${y}${release}`;
}

export function pinchWheelSteps(previousDistance: number, nextDistance: number, pixelsPerStep = 18): number {
  if (previousDistance <= 0 || nextDistance <= 0) return 0;
  return Math.trunc((nextDistance - previousDistance) / pixelsPerStep);
}

function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
