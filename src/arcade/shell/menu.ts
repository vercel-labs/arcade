import { ARCADE_CATALOGUE, ARCADE_WEBSITE_URL } from '../../cinematic/catalogue.ts';

// The arcade's game catalogue: the ordered list of games shown in the Cover Flow
// menu. Functional games come first, then "coming soon" placeholders. This is
// pure data — the menu's 3D presentation lives in coverflow.ts and its selection
// /input wiring lives in main.ts.

export interface MenuItem {
  id: string;
  title: string;
  enabled: boolean; // false → placeholder (dimmed, no-op)
  dev?: boolean; // dev-only surface — hidden from the shipped build (see MENU_ITEMS below)
  externalUrl?: string; // opens immediately; never enters the cover launch animation
}
export type MenuItemAction = { kind: 'launch' } | { kind: 'external'; url: string } | null;

export { ARCADE_WEBSITE_URL };

// The full catalogue. `dev: true` marks internal-only surfaces — the poker-test sandbox
// and the ambient logos / audio / UI-showcase screens — which are development tools, not
// games a private-beta user should see.
const ALL_ITEMS: MenuItem[] = [
  // The interactive walkthrough — a cover like any game, shelved immediately LEFT of Chess in
  // the ring. The carousel opens on Chess (HOME_MENU_INDEX), so the tutorial is one press left
  // every launch; an install's very first launch opens on the tutorial instead, with Chess to
  // its right (see shell/first-run.ts). Same ring either way, just a different starting slot.
  { id: 'tutorial', title: 'Tutorial', enabled: true },
  ...ARCADE_CATALOGUE.slice(0, 3),
  { id: 'trailer', title: 'Trailer', enabled: true },
  { id: 'islanders-test', title: 'Islanders-Test', enabled: true, dev: true },
  ...ARCADE_CATALOGUE.slice(3),
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
export const TUTORIAL_MENU_INDEX = MENU_ITEMS.findIndex((item) => item.id === 'tutorial');
// The slot the carousel opens on: Chess, the flagship.
export const HOME_MENU_INDEX = MENU_ITEMS.findIndex((item) => item.id === 'chess');

export function menuItemAction(item: MenuItem | undefined): MenuItemAction {
  if (!item?.enabled) return null;
  return item.externalUrl ? { kind: 'external', url: item.externalUrl } : { kind: 'launch' };
}
