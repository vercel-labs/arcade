// A textual hyperlink: an underlined label with no border or fill, so it reads as
// prose rather than as a control. Use it where an affordance belongs inline — a
// helper under a field, a "learn more" in a paragraph — and keep Button for the
// pill-shaped actions that anchor a form.
//
// Callers own what following the link means (opening a browser, swapping a view),
// so this component stays platform-free.

import { Button } from '../nodes.ts';
import type { ColorToken } from '../theme.ts';
import type { Node, Padding, Style } from '../types.ts';

export interface LinkOpts {
  id: string;
  label: string;
  onClick?: () => void;
  // Inert but still painted, and no longer focusable (see Button).
  disabled?: boolean;
  color?: ColorToken; // ink at rest (default a muted grey)
  activeColor?: ColorToken; // hover/focus ink (default the brightest text)
  padding?: Padding; // default 0 — a link sits flush with surrounding text
}

export function Link(opts: LinkOpts): Node {
  const lit: Partial<Style> = { color: opts.activeColor ?? 'textStrong', underline: true, bold: true };
  return Button({
    id: opts.id,
    label: opts.label,
    onClick: opts.onClick,
    disabled: opts.disabled,
    style: {
      padding: opts.padding ?? 0,
      color: opts.color ?? 'textMuted',
      // The underline is the link's whole identity, so every state keeps it —
      // only the ink changes, which is all a cell can vary without a fill.
      underline: true,
      hover: lit,
      focus: lit,
      pressed: { color: 'controlPressedBg', underline: true, bold: true },
      disabled: { color: 'disabledFg', underline: true },
    },
  });
}
