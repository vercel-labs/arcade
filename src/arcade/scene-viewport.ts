import type { LayoutBox } from '../tui/index.ts';

export interface ScenePointer {
  ndcX: number;
  ndcY: number;
  aspect: number;
}

// A right-side UI rail owns terminal cells outside this viewport. Rendering the
// 3D scene at this actual size gives its camera the same aspect as the visible
// area instead of drawing a full-width scene behind the rail.
export function insetRightSceneViewport(cols: number, rows: number, reservedRight = 0): LayoutBox {
  const w = Math.max(1, Math.round(cols) - Math.max(0, Math.round(reservedRight)));
  return { x: 0, y: 0, w, h: Math.max(1, Math.round(rows)) };
}

// The mirror of the above for a LEFT/TOP-side panel (the leaderboard's opaque data
// panels + tab bar). Rendering the scene into only the uncovered region gives its
// camera — and the mouse-orbit pivot — the same center as what's actually visible,
// instead of pivoting around the full-screen center hidden behind the panel.
export function insetLeftSceneViewport(cols: number, rows: number, reservedLeft = 0, reservedTop = 0, reservedBottom = 0): LayoutBox {
  const x = Math.max(0, Math.round(reservedLeft));
  const y = Math.max(0, Math.round(reservedTop));
  const b = Math.max(0, Math.round(reservedBottom));
  return { x, y, w: Math.max(1, Math.round(cols) - x), h: Math.max(1, Math.round(rows) - y - b) };
}

// Terminal pointer cells are 1-based; scene/layout coordinates are 0-based.
// Terminal cells are approximately twice as tall as they are wide, matching the
// renderer's two pixel rows per cell.
export function pointerNdcInSceneViewport(x: number, y: number, viewport: LayoutBox): ScenePointer {
  return {
    ndcX: ((x - viewport.x - 0.5) / viewport.w) * 2 - 1,
    ndcY: 1 - ((y - viewport.y - 0.5) / viewport.h) * 2,
    aspect: viewport.w / (viewport.h * 2),
  };
}
