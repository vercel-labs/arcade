// The arcade's game catalogue: the ordered list of games shown in the Cover Flow
// menu. Functional games come first, then "coming soon" placeholders. This is
// pure data — the menu's 3D presentation lives in coverflow.ts and its selection
// /input wiring lives in main.ts.

export interface MenuItem {
  id: string;
  title: string;
  enabled: boolean; // false → placeholder (dimmed, no-op)
}

export const MENU_ITEMS: MenuItem[] = [
  { id: 'chess', title: 'Chess', enabled: true },
  { id: 'logos', title: 'Logos', enabled: true },
  { id: 'audio', title: 'Audio', enabled: true },
  { id: 'ui', title: 'UI', enabled: true },
  { id: 'poker', title: 'Poker', enabled: true },
  { id: 'codenames', title: 'Codenames', enabled: false },
  { id: 'pacman', title: 'Pac-Man', enabled: false },
  { id: 'frogger', title: 'Frogger', enabled: false },
  { id: 'space-invaders', title: 'Space Invaders', enabled: false },
  { id: 'street-fighter', title: 'Street Fighter', enabled: false },
];
