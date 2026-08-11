// Catan presentation colors and glyphs. These encode game meaning (resources,
// players, production states, and Catan-specific actions), so they stay beside
// the game instead of leaking into the shared TUI theme.

import type { DevCardType, PlayerColor, Resource } from '../../../rules/catan/types.ts';

export type CatanRgb = [number, number, number];

export interface CatanCardLook {
  emoji: string;
  name: string;
  fill: CatanRgb;
  ink: CatanRgb;
}

export const DEV_CARD_ICON = '🔨';
export const KNIGHT_ICON = '💂';
export const ROAD_ICON = '➖';
export const SETTLEMENT_ICON = '🏠';

export const RESOURCE_ORDER: Resource[] = ['lumber', 'brick', 'wool', 'grain', 'ore'];
export const RESOURCE_LOOK: Record<Resource, CatanCardLook> = {
  lumber: { emoji: '🌲', name: 'wood', fill: [91, 181, 99], ink: [19, 65, 27] },
  brick: { emoji: '🧱', name: 'brick', fill: [176, 77, 60], ink: [74, 26, 16] },
  wool: { emoji: '🐑', name: 'sheep', fill: [148, 196, 79], ink: [27, 48, 22] },
  grain: { emoji: '🌾', name: 'wheat', fill: [201, 160, 8], ink: [66, 48, 4] },
  ore: { emoji: '🪨', name: 'ore', fill: [135, 167, 161], ink: [26, 44, 42] },
};

export const DEV_FILL: CatanRgb = [125, 86, 167];
export const DEV_INK: CatanRgb = [48, 28, 74];
export const DEV_LOOK: CatanCardLook = { emoji: DEV_CARD_ICON, name: 'dev', fill: DEV_FILL, ink: DEV_INK };
export const DEV_HAND_LOOK: Record<DevCardType, CatanCardLook> = {
  knight: { emoji: KNIGHT_ICON, name: 'knght', fill: DEV_FILL, ink: DEV_INK },
  victoryPoint: { emoji: '🏆', name: 'vp', fill: DEV_FILL, ink: DEV_INK },
  roadBuilding: { emoji: ROAD_ICON, name: 'rb', fill: DEV_FILL, ink: DEV_INK },
  yearOfPlenty: { emoji: '🎁', name: 'yop', fill: DEV_FILL, ink: DEV_INK },
  monopoly: { emoji: '💰', name: 'mono', fill: DEV_FILL, ink: DEV_INK },
};

export const CATAN_CARD = {
  countInk: [250, 252, 255] as CatanRgb,
  emptyFill: [48, 51, 62] as CatanRgb,
  award: [226, 184, 74] as CatanRgb,
  atRisk: [226, 96, 84] as CatanRgb,
  actionBg: [48, 103, 116] as CatanRgb,
  actionHover: [70, 139, 151] as CatanRgb,
  actionDisabled: [45, 49, 58] as CatanRgb,
  actionDisabledInk: [112, 117, 130] as CatanRgb,
  actionInk: [242, 247, 249] as CatanRgb,
  tradeBg: [20, 23, 31, 0.96] as [number, number, number, number],
  tradeAccent: [78, 167, 177] as CatanRgb,
  tradeSlotBg: [29, 32, 42] as CatanRgb,
};

export const PLAYER_LOOK: Record<PlayerColor, CatanRgb> = {
  red: [226, 96, 84],
  blue: [104, 148, 235],
  purple: [212, 172, 232],
  orange: [232, 148, 62],
};

export const CATAN_NUMBER_TOKEN = {
  background: [12, 12, 16] as CatanRgb,
  ink: [238, 236, 230] as CatanRgb,
  red: [232, 74, 74] as CatanRgb,
  hot: [232, 190, 60] as CatanRgb,
  hotInk: [40, 30, 8] as CatanRgb,
  blocked: [92, 98, 108] as CatanRgb,
  blockedInk: [226, 229, 235] as CatanRgb,
};

export const CATAN_STATUS = {
  foreground: [232, 234, 242] as CatanRgb,
  muted: [150, 154, 168] as CatanRgb,
};
