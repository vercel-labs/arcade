import type { CoverFlowItem } from './scenes/cover-flow.ts';

/** Public production order shared by the CLI launcher and launch-film Cover Flow. */
export const ARCADE_CATALOGUE = [
  { id: 'chess', title: 'Chess', enabled: true },
  { id: 'poker', title: 'Poker', enabled: true },
  { id: 'catan', title: 'Catan', enabled: true },
  { id: 'mahjong', title: 'Mahjong', enabled: false },
  { id: 'leaderboard', title: 'Leaderboard', enabled: false },
  { id: 'achievements', title: 'Achievements', enabled: false },
] as const satisfies readonly CoverFlowItem[];
