import type { RGB, RGBA } from '../engine/index.ts';
import { createTheme, type Style } from '../tui/index.ts';

// Arcade's concrete skin for the shared semantic TUI roles. Individual games
// keep their gameplay colors in local palette modules; this object owns only
// reusable application chrome and interaction states.
export const ARCADE_THEME = createTheme({
  surfaceCanvas: [0, 0, 0],
  surfaceChrome: [22, 24, 32],
  surfaceControl: [44, 46, 56],
  surfaceOverlay: [44, 46, 56],
  textPrimary: [212, 214, 224],
  textStrong: [232, 234, 242],
  textMuted: [120, 124, 140],
  tooltipBg: [44, 46, 56],
  tooltipFg: [232, 234, 242],
  tooltipMuted: [168, 172, 188],
});

export const ARCADE_CHROME_TEXT = {
  title: [222, 224, 234] as RGB,
  body: [224, 226, 234] as RGB,
  muted: [138, 142, 156] as RGB,
  secondary: [170, 174, 188] as RGB,
};

export const ARCADE_OUTLINE_CONTROL = {
  activeText: [200, 206, 236] as RGB,
  activeBorder: [112, 122, 188] as RGB,
  neutralText: ARCADE_THEME.textPrimary,
  neutralBorder: [88, 92, 110] as RGB,
};

// One source of truth for Arcade's dark floating chrome: menus, move/chat
// panels, and the compact top-right controls all rest on the menu-modal color.
export const UI_CHROME_BG: RGB = ARCADE_THEME.surfaceChrome;

export function uiChromeBg(alpha: number): RGBA {
  return [UI_CHROME_BG[0], UI_CHROME_BG[1], UI_CHROME_BG[2], alpha];
}

// Body copy inside a Sidebar. These belong to the content the games put in the
// panel, not to the panel chrome, so they live app-side rather than travelling
// with the Sidebar component.
export const RAIL_TEXT_FG: RGB = ARCADE_CHROME_TEXT.body;
export const RAIL_MUTED_FG: RGB = ARCADE_CHROME_TEXT.muted; // events, secondary stats
export const RAIL_ERROR_FG: RGB = [220, 80, 80]; // error/system events shared by every game rail

export const UI_CHROME_PILL: Style = {
  padding: [0, 1],
  background: 'surfaceChrome',
  color: [200, 205, 220],
  hover: { background: 'controlHoverBg', color: 'controlHoverFg' },
  focus: { background: 'controlFocusBg', color: 'controlFocusFg' },
  pressed: { background: 'controlPressedBg', color: 'controlPressedFg' },
};

export const MENU_BUTTON_LABEL = '☰ menu';
