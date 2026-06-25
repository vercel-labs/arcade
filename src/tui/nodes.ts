// Node factories. A UI tree is plain data built with these — no JSX, no
// reconciler. Rebuild the tree each frame; the Screen retains interaction state
// (focus/hover/pressed) by `id`, so the literals stay pure.

import type { KeyEvent } from '../platform/input.ts';
import type { Node, Style } from './types.ts';

// A layout container, optionally with a background/border.
export function Box(style: Style, children: Node[] = []): Node {
  return { kind: 'box', style, children };
}

// A run of text. In v1 a Text needs a background (its own or an ancestor Box's)
// to be legible — transparent text over the live scene arrives with Phase 4.
export function Text(opts: { text: string; id?: string; style?: Style }): Node {
  return { kind: 'text', text: opts.text, id: opts.id, style: opts.style ?? {} };
}

// A focusable, clickable label. Defaults to pill padding ([0, 2]) — the two
// spaces each side that the old button labels hardcoded.
export function Button(opts: {
  id: string;
  label: string;
  onClick?: () => void;
  onKey?: (ev: KeyEvent) => boolean;
  style?: Style;
}): Node {
  return {
    kind: 'button',
    id: opts.id,
    text: opts.label,
    focusable: true,
    onClick: opts.onClick,
    onKey: opts.onKey,
    style: { padding: [0, 2], ...opts.style },
  };
}
