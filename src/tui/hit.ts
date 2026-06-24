// Hit-testing reads the same `LayoutBox` that paint reads, so what you click is
// exactly what you see. Coordinates are 0-based cells (the Screen converts from
// the platform's 1-based mouse coords).

import type { LayoutBox, Node } from './types.ts';

function contains(lb: LayoutBox, x: number, y: number): boolean {
  return x >= lb.x && x < lb.x + lb.w && y >= lb.y && y < lb.y + lb.h;
}

// Topmost interactive node containing the point, or null. Later nodes in
// preorder paint on top, so the last match wins.
export function hitTest(root: Node, x: number, y: number): Node | null {
  let found: Node | null = null;
  const walk = (n: Node): void => {
    if (n.layout && contains(n.layout, x, y) && (n.focusable || n.onClick)) found = n;
    for (const c of n.children ?? []) walk(c);
  };
  walk(root);
  return found;
}
