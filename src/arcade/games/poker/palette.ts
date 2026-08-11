// Poker-only semantic colors. Shared panels, controls, text, scrollbars, and
// tooltips come from the Arcade/TUI themes; these colors communicate card and
// table state and therefore belong to the game.

import type { RGB } from '../../../engine/index.ts';

export const POKER_PALETTE = {
  actionFoldBg: [96, 44, 44] as RGB,
  actionFoldFg: [246, 220, 218] as RGB,
  actionFoldHoverBg: [150, 58, 58] as RGB,
  actionFoldHoverFg: [255, 240, 238] as RGB,
  actionRaiseBg: [62, 70, 118] as RGB,
  actionRaiseFg: [228, 232, 248] as RGB,
  actionRaiseHoverBg: [88, 98, 154] as RGB,
  actionRaiseHoverFg: [244, 246, 255] as RGB,
  actionChipBg: [38, 40, 50] as RGB,
  actionChipFg: [200, 204, 216] as RGB,

  matchReady: [120, 205, 142] as RGB,
  matchDisabled: [110, 114, 126] as RGB,
  pauseFg: [200, 206, 236] as RGB,
  pauseBorder: [112, 122, 188] as RGB,
  voiceConfirm: [232, 210, 140] as RGB,

  cardFace: [230, 230, 236] as RGB,
  cardRed: [196, 30, 40] as RGB,
  cardBlack: [20, 20, 28] as RGB,
  cardDown: [44, 46, 56] as RGB,
  cardDownFg: [126, 130, 148] as RGB,

  noteHeading: [232, 214, 150] as RGB,
  noteText: [206, 210, 222] as RGB,
  notePlaceholder: [92, 96, 112] as RGB,

  potBg: [150, 116, 40] as RGB,
  potFg: [24, 18, 6] as RGB,
  playerName: [224, 226, 236] as RGB,
  chipText: [236, 238, 246] as RGB,
  actionText: [232, 214, 150] as RGB,
  madeHandText: [176, 182, 200] as RGB,
  foldedText: [116, 120, 136] as RGB,
  winnerBg: [150, 116, 40] as RGB,
  winnerInk: [26, 20, 6] as RGB,
  activeSeatBg: [46, 52, 72, 0.96] as const,
};
