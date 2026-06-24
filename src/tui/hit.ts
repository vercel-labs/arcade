// Hit-testing reads the same `LayoutBox` that paint reads, so what you click is
// exactly what you see. Coordinates are 0-based cells (the Screen converts from
// the platform's 1-based mouse coords).

import type { LayoutBox, Node } from './types.ts';

function contains(lb: LayoutBox, x: number, y: number): boolean {
  return x >= lb.x && x < lb.x + lb.w && y >= lb.y && y < lb.y + lb.h;
}

// Topmost interactive node containing the point, or null. Later nodes in
// preorder paint on top, so the last match wins. A clipped node is only hit
// where it's actually visible (inside its clip rect).
export function hitTest(root: Node, x: number, y: number): Node | null {
  let found: Node | null = null;
  const walk = (n: Node): void => {
    const visible = n.layout && contains(n.layout, x, y) && (!n.clip || contains(n.clip, x, y));
    if (visible && (n.focusable || n.onClick)) found = n;
    for (const c of n.children ?? []) walk(c);
  };
  walk(root);
  return found;
}
