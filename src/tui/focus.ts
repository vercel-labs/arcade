// Focus order is the preorder traversal of focusable, id'd nodes — the terminal
// analogue of DOM tab order. Tab walks forward through this list.

import type { Node } from './types.ts';

export function focusOrder(root: Node): Node[] {
  const out: Node[] = [];
  const walk = (n: Node): void => {
    // Ordinary disabled controls are skipped. A disabled control with an explanatory tooltip
    // remains focusable so keyboard users can inspect why the action is unavailable.
    if (n.focusable && n.id && (!n.disabled || n.tooltip)) out.push(n);
    for (const c of n.children ?? []) walk(c);
  };
  walk(root);
  return out;
}
