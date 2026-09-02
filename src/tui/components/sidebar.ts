// The edge sidebar: a translucent column with a title + ✕ header, shared by the chess
// chat, the poker chat, and the Islanders sidebar. Each caller supplies its own body (a chat
// thread, a scrollable history, stacked sections) while the chrome, insets, and header
// live here, so every panel reads as the same object.
//
// A sidebar participates in the layout rather than painting over the scene behind it:
// whoever opens one must also inset the scene viewport by the same width, or projected
// scene overlays (Islanders's number chips and port labels) land underneath the panel.

import { Box, Text } from '../nodes.ts';
import type { ColorToken } from '../theme.ts';
import type { Dimension, Node } from '../types.ts';
import { CloseButton } from './dialog.ts';

export const SIDEBAR_PAD_L = 2; // a touch more on the left, to hold text off the scene edge
// ZERO on the right so a scrollbar sits flush at the panel edge. A right inset leaves a
// translucent strip showing the moving scene through it, which reads as a jagged edge.
export const SIDEBAR_PAD_R = 0;
export const SIDEBAR_PAD_V = 1; // top/bottom inset
export const SIDEBAR_HEADER_H = 2; // header row + the gap row under it

const HEADER_RIGHT_PAD = 2; // insets the ✕ from the terminal edge

export interface SidebarOpts {
  width: number;
  height?: Dimension;
  // A plain label, or a Node when the title itself is interactive (the chess chat makes
  // its title a second collapse target alongside the ✕).
  title: string | Node;
  closeId: string;
  onClose: () => void;
  // The surface the panel rests on. Passed in rather than resolved here so the library
  // carries no app palette, and so every panel moves together when the app retints
  // its chrome.
  background: ColorToken;
  // Ink for a plain-string title; omit and it inherits the panel's color. A Node title
  // styles itself, so callers passing one don't supply this at all.
  titleColor?: ColorToken;
  flexShrink?: number;
}

export function Sidebar(o: SidebarOpts, children: Node[]): Node {
  const title = typeof o.title === 'string' ? Text({ text: o.title, style: { color: o.titleColor, bold: true } }) : o.title;
  const header = Box(
    {
      flexDirection: 'row',
      justifyContent: 'between',
      alignItems: 'center',
      width: o.width - SIDEBAR_PAD_L - SIDEBAR_PAD_R,
      padding: [0, HEADER_RIGHT_PAD, 0, 0],
    },
    [title, CloseButton({ id: o.closeId, onClick: o.onClose })],
  );
  return Box(
    {
      flexDirection: 'column',
      width: o.width,
      height: o.height,
      flexShrink: o.flexShrink,
      padding: [SIDEBAR_PAD_V, SIDEBAR_PAD_R, SIDEBAR_PAD_V, SIDEBAR_PAD_L],
      background: o.background,
    },
    [header, Box({ height: 1 }), ...children],
  );
}
