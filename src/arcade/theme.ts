import type { RGB, RGBA } from '../engine/index.ts';
import type { Style } from '../tui/index.ts';

// One source of truth for Arcade's dark floating chrome: menus, move/chat
// panels, and the compact top-right controls all rest on the menu-modal color.
export const UI_CHROME_BG: RGB = [22, 24, 32];

export function uiChromeBg(alpha: number): RGBA {
  return [UI_CHROME_BG[0], UI_CHROME_BG[1], UI_CHROME_BG[2], alpha];
}

export const UI_CHROME_PILL: Style = {
  padding: [0, 1],
  background: UI_CHROME_BG,
  color: [200, 205, 220],
  hover: { background: [238, 240, 248], color: [16, 16, 24] },
  focus: { background: [86, 90, 108], color: [248, 248, 252] },
  pressed: { background: [255, 255, 255], color: [12, 12, 18] },
};
