// The arcade's game catalogue: the ordered list of games shown in the Cover Flow
// menu. Functional games come first, then "coming soon" placeholders. This is
// pure data — the menu's 3D presentation lives in coverflow.ts and its selection
// /input wiring lives in main.ts.

export interface MenuItem {
  id: string;
  title: string;
  enabled: boolean; // false → placeholder (dimmed, no-op)
  dev?: boolean; // dev-only surface — hidden from the shipped build (see MENU_ITEMS below)
}

// The full catalogue. `dev: true` marks internal-only surfaces — the poker-test sandbox
// and the ambient logos / audio / UI-showcase screens — which are development tools, not
// games a private-beta user should see.
const ALL_ITEMS: MenuItem[] = [
  { id: 'chess', title: 'Chess', enabled: true },
  { id: 'poker', title: 'Poker', enabled: true },
  { id: 'catan', title: 'Catan', enabled: false },
  { id: 'catan-test', title: 'Catan-Test', enabled: true, dev: true },
  { id: 'mahjong', title: 'Mahjong', enabled: false },
  { id: 'leaderboard', title: 'Leaderboard', enabled: false },
  { id: 'achievements', title: 'Achievements', enabled: false },
  { id: 'poker-test', title: 'Poker-Test', enabled: true, dev: true },
  { id: 'logos', title: 'Logos', enabled: true, dev: true },
  { id: 'audio', title: 'Audio', enabled: true, dev: true },
  { id: 'ui', title: 'UI', enabled: true, dev: true },
];

// Dev surfaces are gated fail-closed: hidden unless ARCADE_DEV=1. The `pnpm dev` / `watch`
// / `snapshot` scripts set it, so they're always visible locally; the shipped npx build
// sets nothing, so it never exposes them. Every consumer (main's selection, coverflow, the
// launch handler) reads this filtered list, so indices stay consistent.
const DEV = process.env.ARCADE_DEV === '1';
export const MENU_ITEMS: MenuItem[] = ALL_ITEMS.filter((item) => DEV || !item.dev);
