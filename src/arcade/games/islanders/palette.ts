// Islanders presentation colors and glyphs. These encode game meaning (resources,
// players, production states, and Islanders-specific actions), so they stay beside
// the game instead of leaking into the shared TUI theme.

import type { DevCardType, PlayerColor, Resource } from '../../../rules/islanders/types.ts';

export type IslandersRgb = [number, number, number];

export interface IslandersCardLook {
  emoji: string;
  name: string;
  fill: IslandersRgb;
  ink: IslandersRgb;
}

export const DEV_CARD_ICON = '🔨';
export const KNIGHT_ICON = '💂';
export const ROAD_ICON = '➖';
export const SETTLEMENT_ICON = '🏠';
export const CITY_ICON = '🏰';
// End of turn: skip ahead to the flag. Fast-forward is the one forward glyph with
// Emoji_Presentation=Yes (next-track ⏭ is not, so its width varies by terminal).
export const FAST_FORWARD_ICON = '⏩';

export const RESOURCE_ORDER: Resource[] = ['lumber', 'brick', 'wool', 'grain', 'ore'];
export const RESOURCE_LOOK: Record<Resource, IslandersCardLook> = {
  lumber: { emoji: '🪵', name: 'wood', fill: [86, 174, 95], ink: [19, 65, 27] },
  brick: { emoji: '🧱', name: 'brick', fill: [176, 77, 60], ink: [74, 26, 16] },
  wool: { emoji: '🐑', name: 'sheep', fill: [148, 196, 79], ink: [27, 48, 22] },
  grain: { emoji: '🌾', name: 'wheat', fill: [189, 140, 8], ink: [66, 48, 4] },
  ore: { emoji: '🪨', name: 'ore', fill: [135, 167, 161], ink: [26, 44, 42] },
};

export const DEV_FILL: IslandersRgb = [125, 86, 167];
export const DEV_INK: IslandersRgb = [48, 28, 74];
export const DEV_LOOK: IslandersCardLook = { emoji: DEV_CARD_ICON, name: 'dev', fill: DEV_FILL, ink: DEV_INK };
export const DEV_HAND_LOOK: Record<DevCardType, IslandersCardLook> = {
  knight: { emoji: KNIGHT_ICON, name: 'knght', fill: DEV_FILL, ink: DEV_INK },
  victoryPoint: { emoji: '🏆', name: 'vp', fill: DEV_FILL, ink: DEV_INK },
  roadBuilding: { emoji: ROAD_ICON, name: 'rb', fill: DEV_FILL, ink: DEV_INK },
  yearOfPlenty: { emoji: '🎁', name: 'yop', fill: DEV_FILL, ink: DEV_INK },
  monopoly: { emoji: '💰', name: 'mono', fill: DEV_FILL, ink: DEV_INK },
};

export const ISLANDERS_CARD = {
  countInk: [250, 252, 255] as IslandersRgb,
  emptyFill: [48, 51, 62] as IslandersRgb,
  award: [226, 184, 74] as IslandersRgb,
  atRisk: [226, 96, 84] as IslandersRgb,
  actionBg: [48, 103, 116] as IslandersRgb,
  actionHover: [70, 139, 151] as IslandersRgb,
  actionDisabled: [45, 49, 58] as IslandersRgb,
  actionDisabledInk: [112, 117, 130] as IslandersRgb,
  cancelBg: [68, 72, 82] as IslandersRgb,
  cancelHover: [91, 96, 108] as IslandersRgb,
  actionInk: [242, 247, 249] as IslandersRgb,
  actionHoverInk: [255, 255, 255] as IslandersRgb,
  actionPressed: [221, 241, 244] as IslandersRgb,
  actionPressedInk: [19, 48, 54] as IslandersRgb,
  devActionHover: [149, 109, 190] as IslandersRgb,
  devActionPressed: [205, 181, 229] as IslandersRgb,
  // The roll card: the one action a turn cannot proceed without, in its own warm tone so it
  // stands apart from the teal trade and purple dev tiles beside it.
  rollActionBg: [176, 112, 52] as IslandersRgb,
  rollActionHover: [206, 142, 78] as IslandersRgb,
  rollActionPressed: [244, 222, 190] as IslandersRgb,
  tradeBg: [20, 23, 31, 0.96] as [number, number, number, number],
  tradeAccent: [78, 167, 177] as IslandersRgb,
  tradeInk: [13, 36, 41] as IslandersRgb,
  tradeHover: [102, 194, 201] as IslandersRgb,
  tradeHoverInk: [8, 27, 31] as IslandersRgb,
  tradeSlotBg: [29, 32, 42] as IslandersRgb,
};

export const PLAYER_LOOK: Record<PlayerColor, IslandersRgb> = {
  red: [226, 96, 84],
  blue: [104, 148, 235],
  purple: [212, 172, 232],
  orange: [232, 148, 62],
};

export const ISLANDERS_NUMBER_TOKEN = {
  background: [12, 12, 16] as IslandersRgb,
  ink: [238, 236, 230] as IslandersRgb,
  red: [232, 74, 74] as IslandersRgb,
  hot: [232, 190, 60] as IslandersRgb,
  hotInk: [40, 30, 8] as IslandersRgb,
  blocked: [92, 98, 108] as IslandersRgb,
  blockedInk: [226, 229, 235] as IslandersRgb,
};

export const ISLANDERS_STATUS = {
  foreground: [232, 234, 242] as IslandersRgb,
  muted: [150, 154, 168] as IslandersRgb,
};
