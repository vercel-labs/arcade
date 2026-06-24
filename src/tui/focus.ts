// Focus order is the preorder traversal of focusable, id'd nodes — the terminal
// analogue of DOM tab order. Tab walks forward through this list.

import type { Node } from './types.ts';

export function focusOrder(root: Node): Node[] {
  const out: Node[] = [];
  const walk = (n: Node): void => {
    if (n.focusable && n.id) out.push(n);
    for (const c of n.children ?? []) walk(c);
  };
  walk(root);
  return out;
}
