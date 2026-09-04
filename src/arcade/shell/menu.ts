import { ARCADE_CATALOGUE, ARCADE_WEBSITE_URL } from '../../cinematic/catalogue.ts';

// The arcade's game catalogue: the ordered list of games shown in the Cover Flow
// menu, in production order, with the dev-only surfaces trailing. This is
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

// The full catalogue, in production order: the three games, the two coming-soon covers,
// the website, then the Trailer and the Tutorial. Because the carousel is a ring, the
// tutorial's last slot puts it one press LEFT of Chess (HOME_MENU_INDEX) every launch, and an
// install's very first launch opens on it instead (see shell/first-run.ts). `dev: true`
// marks internal-only surfaces — the test sandboxes and the ambient logos / audio /
// UI-showcase screens — which are development tools, not games a player should see.
const ALL_ITEMS: MenuItem[] = [
  ...ARCADE_CATALOGUE,
  { id: 'trailer', title: 'Trailer', enabled: true },
  { id: 'tutorial', title: 'Tutorial', enabled: true },
  { id: 'islanders-test', title: 'Islanders-Test', enabled: true, dev: true },
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

// The dim tail drawn after a cover's title: what a placeholder is, that a cover is a
// development surface, and on an install's first launch a nudge under the Tutorial.
export function coverTail(item: MenuItem, firstLaunch: boolean): string {
  if (!item.enabled) return 'coming soon';
  if (item.dev) return 'dev only';
  if (item.id === 'tutorial' && firstLaunch) return 'new here? start with this';
  return '';
}

export function menuItemAction(item: MenuItem | undefined): MenuItemAction {
  if (!item?.enabled) return null;
  return item.externalUrl ? { kind: 'external', url: item.externalUrl } : { kind: 'launch' };
}
