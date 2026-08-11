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

function isHoverTarget(n: Node): boolean {
  return Boolean(n.hoverable || isInteractive(n));
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
// whole tree (see paint.ts). Nested overlays are a still-higher layer, so their
// dropdown rows beat ordinary children painted later inside the outer modal.
function deepest(root: Node, x: number, y: number, pred: (n: Node) => boolean): Node | null {
  let best: Node | null = null;
  let bestDepth = -1;
  const walk = (n: Node, overlayDepth: number): void => {
    // A pass-through visual suppresses the whole subtree. Treating descendants
    // the same way keeps an opaque label's Text child from unexpectedly becoming
    // interactive when the label itself is deliberately transparent to input.
    if (n.style.pointerEvents === 'none') return;
    const depth = overlayDepth + (n.overlay ? 1 : 0);
    const visible = n.layout && contains(n.layout, x, y) && (!n.clip || contains(n.clip, x, y));
    // At equal depth, later preorder nodes paint later and therefore win.
    if (visible && pred(n) && depth >= bestDepth) {
      best = n;
      bestDepth = depth;
    }
    for (const c of n.children ?? []) walk(c, depth);
  };
  walk(root, 0);
  return best;
}

// Topmost INTERACTIVE node at the point (the routing target for onClick/onMouse/
// focus). A background-only child (e.g. a Select's highlighted row) is skipped,
// so events route to the component that owns it.
export function hitTest(root: Node, x: number, y: number): Node | null {
  return deepest(root, x, y, isInteractive);
}

// Hover-only nodes (for example a passive Tooltip trigger) participate here
// without becoming click targets or swallowing scene gestures.
export function hoverTest(root: Node, x: number, y: number): Node | null {
  return deepest(root, x, y, isHoverTarget);
}

// Topmost SURFACE at the point — used to decide whether a gesture is absorbed by
// the UI (returns non-null over any solid panel) versus passes through to the
// scene (null over transparent gaps / open scene).
export function hitSurface(root: Node, x: number, y: number): Node | null {
  return deepest(root, x, y, isSurface);
}
