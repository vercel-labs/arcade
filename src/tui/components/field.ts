// A compact label + control recipe for HUD forms. The returned tree is plain
// TUI data, so callers still own the control and can compose fields anywhere.

import { Box, Text } from '../nodes.ts';
import type { Node, Style } from '../types.ts';

export interface FieldOpts {
  label: string;
  child: Node;
  style?: Style;
  labelStyle?: Style;
}

export function Field(options: FieldOpts): Node {
  return Box(
    { flexDirection: 'column', gap: 0, ...options.style },
    [
      Text({ text: options.label, style: { color: 'textMuted', ...options.labelStyle } }),
      options.child,
    ],
  );
}
