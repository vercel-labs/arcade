// A compact label + control recipe for HUD forms. The returned tree is plain
// TUI data, so callers still own the control and can compose fields anywhere.

import { Box, Text } from '../nodes.ts';
import type { Node, Style } from '../types.ts';

export interface FieldOpts {
  label: string;
  child: Node | Node[];
  direction?: 'column' | 'row';
  labelWidth?: number;
  style?: Style;
  labelStyle?: Style;
}

export function Field(options: FieldOpts): Node {
  const row = options.direction === 'row';
  const children = Array.isArray(options.child) ? options.child : [options.child];
  return Box(
    { flexDirection: row ? 'row' : 'column', gap: row ? 1 : 0, ...(row ? { alignItems: 'start' as const } : {}), ...options.style },
    [
      ...(row && options.labelWidth != null
        ? [Box({ width: options.labelWidth }, [Text({ text: options.label, style: { color: 'textMuted', ...options.labelStyle } })])]
        : [Text({ text: options.label, style: { color: 'textMuted', ...options.labelStyle } })]),
      ...children,
    ],
  );
}
