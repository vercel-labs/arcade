import type { CoverFlowItem } from './scenes/cover-flow.ts';

export const ARCADE_WEBSITE_URL = 'https://ascii-arcade.vercel.app';

/** Public production order shared by the CLI launcher and launch-film Cover Flow. */
export const ARCADE_CATALOGUE = [
  { id: 'chess', title: 'Chess', enabled: true },
  { id: 'poker', title: 'Poker', enabled: true },
  { id: 'islanders', title: 'Islanders', enabled: true },
  { id: 'leaderboard', title: 'Leaderboard', enabled: false },
  { id: 'achievements', title: 'Achievements', enabled: false },
  { id: 'website', title: 'Website', enabled: true, externalUrl: ARCADE_WEBSITE_URL },
] as const satisfies readonly CoverFlowItem[];
