import type { LayoutBox } from './types.ts';

export interface ScenePointer {
  ndcX: number;
  ndcY: number;
  aspect: number;
}

export interface SceneViewportInsets {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

function inset(value = 0): number {
  return Math.max(0, Math.round(value));
}

/** Reserve arbitrary terminal-cell insets around the rectangular viewport used by a scene. */
export function insetSceneViewport(
  cols: number,
  rows: number,
  insets: SceneViewportInsets = {},
): LayoutBox {
  const totalCols = Math.max(1, Math.round(cols));
  const totalRows = Math.max(1, Math.round(rows));
  const left = Math.min(totalCols - 1, inset(insets.left));
  const top = Math.min(totalRows - 1, inset(insets.top));
  return {
    x: left,
    y: top,
    w: Math.max(1, totalCols - left - inset(insets.right)),
    h: Math.max(1, totalRows - top - inset(insets.bottom)),
  };
}

// Terminal pointer cells are 1-based; scene/layout coordinates are 0-based.
// The caller supplies its renderer's pixel height/width ratio for one terminal cell.
export function pointerNdcInSceneViewport(
  x: number,
  y: number,
  viewport: LayoutBox,
  cellPixelAspect: number,
): ScenePointer {
  if (!Number.isFinite(cellPixelAspect) || cellPixelAspect <= 0) {
    throw new RangeError(`cellPixelAspect must be positive, got ${cellPixelAspect}`);
  }
  return {
    ndcX: ((x - viewport.x - 0.5) / viewport.w) * 2 - 1,
    ndcY: 1 - ((y - viewport.y - 0.5) / viewport.h) * 2,
    aspect: viewport.w / (viewport.h * cellPixelAspect),
  };
}
