// The right-edge rail panel: a dark translucent column with a title + ✕ header, shared by the
// chess chat, the poker chat, and the Catan sidebar. Each game supplies its own body (a chat
// thread, a scrollable history, stacked sections) but the chrome, insets, and background are one
// definition here so the three rails read as the same object.
//
// A rail participates in the 3D layout rather than painting over it: whoever opens one must also
// inset the scene viewport by the same width (see activeSceneViewport in main.ts), or the scene's
// projected overlays — number chips, port labels — land under the panel.

import { Box, Button, CloseButton, type Dimension, type Node, type Style, Text } from '../../tui/index.ts';
import type { RGB } from '../../engine/index.ts';
import { uiChromeBg } from '../theme.ts';

export const RAIL_PAD_L = 2; // a touch more on the left, to hold the text off the scene edge
// ZERO on the right so a scrollbar sits flush at the panel edge. A right inset leaves a
// translucent strip that shows the moving scene through it, reading as a jagged edge.
export const RAIL_PAD_R = 0;
export const RAIL_PAD_V = 1; // top/bottom inset
export const RAIL_HEADER_H = 2; // header row + the gap row under it
const HEADER_RIGHT_PAD = 2; // insets the ✕ from the terminal edge

export const RAIL_TITLE_FG: RGB = [222, 224, 234];
export const RAIL_TEXT_FG: RGB = [224, 226, 234]; // body copy
export const RAIL_MUTED_FG: RGB = [138, 142, 156]; // events, secondary stats

export interface RailPanelOpts {
  width: number;
  height?: Dimension;
  // A plain label, or a Node when the title itself is interactive (the chess chat's toggle).
  title: string | Node;
  closeId: string;
  onClose: () => void;
  flexShrink?: number;
}

export function RailPanel(o: RailPanelOpts, children: Node[]): Node {
  const title = typeof o.title === 'string' ? Text({ text: o.title, style: { color: RAIL_TITLE_FG, bold: true } }) : o.title;
  const header = Box({ flexDirection: 'row', justifyContent: 'between', alignItems: 'center', width: o.width - RAIL_PAD_L - RAIL_PAD_R, padding: [0, HEADER_RIGHT_PAD, 0, 0] }, [
    title,
    CloseButton({ id: o.closeId, onClick: o.onClose }),
  ]);
  return Box({ flexDirection: 'column', width: o.width, height: o.height, flexShrink: o.flexShrink, padding: [RAIL_PAD_V, RAIL_PAD_R, RAIL_PAD_V, RAIL_PAD_L], background: uiChromeBg(0.9) }, [
    header,
    Box({ height: 1 }),
    ...children,
  ]);
}

// A header title that is itself a button (chess uses it to collapse from the title as well as
// the ✕). Kept here so the two rails style their titles identically.
export function RailTitleButton(id: string, label: string, onClick: () => void, style: Style): Node {
  return Button({ id, label, onClick, style });
}
