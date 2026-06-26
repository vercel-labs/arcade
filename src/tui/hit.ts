// Hit-testing reads the same `LayoutBox` that paint reads, so what you click is
// exactly what you see. Coordinates are 0-based cells (the Screen converts from
// the platform's 1-based mouse coords).

import type { LayoutBox, Node } from './types.ts';

function contains(lb: LayoutBox, x: number, y: number): boolean {
  return x >= lb.x && x < lb.x + lb.w && y >= lb.y && y < lb.y + lb.h;
}

// A node that handles input — the routing target for clicks/keys/wheel.
function isInteractive(n: Node): boolean {
  return Boolean(n.focusable || n.onClick || n.onMouse);
}

// A painted surface — interactive nodes, plus any node with a non-transparent
// background or a scrim. The web model: a solid panel catches the pointer so
// gestures don't fall through to whatever is painted behind it (here, the 3D
// scene). A transparent layout container (the screen root, the bar's row between
// pills) is NOT a surface, so the scene stays draggable through the gaps.
function isSurface(n: Node): boolean {
  if (isInteractive(n)) return true;
  const bg = n.style.background;
  if (bg != null && bg !== 'transparent') return true;
  return n.style.scrim != null;
}

// Topmost node matching `pred` that contains the point, or null. Later nodes in
// preorder paint on top, so the last match wins. A clipped node is only hit where
// it's actually visible (inside its clip rect). Overlay subtrees paint above the
// whole tree (see paint.ts), so any match inside one beats every non-overlay
// match — mirrored here by tracking the two separately and preferring the overlay.
function deepest(root: Node, x: number, y: number, pred: (n: Node) => boolean): Node | null {
  let base: Node | null = null;
  let over: Node | null = null;
  const walk = (n: Node, inOverlay: boolean): void => {
    const here = inOverlay || n.overlay === true;
    const visible = n.layout && contains(n.layout, x, y) && (!n.clip || contains(n.clip, x, y));
    if (visible && pred(n)) {
      if (here) over = n;
      else base = n;
    }
    for (const c of n.children ?? []) walk(c, here);
  };
  walk(root, false);
  return over ?? base;
}

// Topmost INTERACTIVE node at the point (the routing target for onClick/onMouse/
// focus). A background-only child (e.g. a Select's highlighted row) is skipped,
// so events route to the component that owns it.
export function hitTest(root: Node, x: number, y: number): Node | null {
  return deepest(root, x, y, isInteractive);
}

// Topmost SURFACE at the point — used to decide whether a gesture is absorbed by
// the UI (returns non-null over any solid panel) versus passes through to the
// scene (null over transparent gaps / open scene).
export function hitSurface(root: Node, x: number, y: number): Node | null {
  return deepest(root, x, y, isSurface);
}
