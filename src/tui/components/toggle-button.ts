// One-row terminal slider: a rectangular five-cell track with a white thumb, followed by a
// fixed-width textual state. Callers own state; clicking anywhere on the control toggles it.

import { Box, Button, Text } from '../nodes.ts';
import type { ColorToken } from '../theme.ts';
import type { Node } from '../types.ts';

export interface ToggleButtonOpts {
  id: string;
  value: boolean;
  onChange: (value: boolean) => void;
  width?: number;
  onColor?: ColorToken;
}

export function ToggleButton(opts: ToggleButtonOpts): Node {
  const width = Math.max(9, opts.width ?? 9);
  const value = opts.value ? 'on' : 'off';
  const track: ColorToken = opts.value ? (opts.onColor ?? [112, 116, 130]) : [58, 60, 70];
  const thumb = [242, 244, 250] as ColorToken;
  const button = Button({
    id: opts.id,
    label: '',
    onClick: () => opts.onChange(!opts.value),
    style: {
      width,
      height: 1,
      padding: 0,
      hover: { color: 'textStrong' },
      focus: { color: 'textStrong', bold: true },
      pressed: { color: 'textStrong', bold: true },
    },
  });
  const trackCells: ColorToken[] = opts.value
    ? [track, track, track, track, thumb]
    : [thumb, track, track, track, track];
  button.children = [Box({ width, height: 1, gap: 1, alignItems: 'center' }, [
    Box({ width: 5, height: 1 }, trackCells.map((background, index) =>
      Text({ text: ' ', id: `${opts.id}-track-${index}`, style: { width: 1, background } }))),
    Text({ text: value.padEnd(3), style: { width: 3, color: opts.value ? 'textPrimary' : 'textMuted', bold: opts.value } }),
  ])];
  return button;
}
