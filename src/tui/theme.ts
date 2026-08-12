// Semantic color tokens. Components reference token names (or explicit colors);
// resolveColor maps a token to a concrete RGBA at paint time. One place to
// retheme the whole UI instead of scattering literals through component styles.

import { parseColor, type RGB, type RGBA } from '../engine/index.ts';

export interface Theme {
  // Semantic surfaces. Components should choose by role rather than copying a
  // concrete RGB tuple, so an app can replace the whole palette at Screen level.
  surfaceCanvas: RGB;
  surfaceChrome: RGB;
  surfaceControl: RGB;
  surfaceOverlay: RGB;
  // Semantic text roles.
  textPrimary: RGB;
  textStrong: RGB;
  textMuted: RGB;
  textInverse: RGB;
  // Shared interaction states.
  controlHoverBg: RGB;
  controlHoverFg: RGB;
  controlFocusBg: RGB;
  controlFocusFg: RGB;
  controlPressedBg: RGB;
  controlPressedFg: RGB;
  // Shared component furniture.
  scrollbarTrack: RGB;
  scrollbarThumb: RGB;
  selectionBg: RGB;
  selectionFg: RGB;
  tooltipBg: RGB;
  tooltipFg: RGB;
  tooltipMuted: RGB;
  scrim: RGBA;

  // Compact compatibility tokens used throughout existing app trees. New
  // components should prefer the semantic roles above; keeping these aliases
  // makes theme migration incremental rather than an all-at-once app rewrite.
  fg: RGB;
  bg: RGB;
  accent: RGB;
  muted: RGB;
  pillBg: RGB;
  pillFg: RGB;
  pillHoverBg: RGB;
  pillHoverFg: RGB;
  focusRing: RGB;
  danger: RGB;
  // A control that is present but inert. Kept a real surface rather than dropped to
  // the page color, so the shape still reads as a control you can't use yet.
  disabledBg: RGB;
  disabledFg: RGB;
}

export const defaultTheme: Theme = {
  surfaceCanvas: [0, 0, 0],
  surfaceChrome: [22, 24, 32],
  surfaceControl: [44, 46, 56],
  surfaceOverlay: [44, 46, 56],
  textPrimary: [212, 214, 224],
  textStrong: [232, 234, 242],
  textMuted: [120, 124, 140],
  textInverse: [16, 16, 24],
  controlHoverBg: [238, 240, 248],
  controlHoverFg: [16, 16, 24],
  controlFocusBg: [86, 90, 108],
  controlFocusFg: [248, 248, 252],
  controlPressedBg: [255, 255, 255],
  controlPressedFg: [12, 12, 18],
  scrollbarTrack: [44, 46, 56],
  scrollbarThumb: [150, 154, 170],
  selectionBg: [131, 165, 152],
  selectionFg: [12, 18, 24],
  tooltipBg: [44, 46, 56],
  tooltipFg: [232, 234, 242],
  tooltipMuted: [168, 172, 188],
  scrim: [6, 8, 12, 0.55],
  fg: [212, 214, 224],
  bg: [0, 0, 0],
  accent: [112, 122, 188], // slate-indigo — the app's accent (matches the RoundedButton / bet-raise indigo)
  muted: [120, 124, 140],
  pillBg: [44, 46, 56],
  pillFg: [212, 214, 224],
  pillHoverBg: [238, 240, 248],
  pillHoverFg: [16, 16, 24],
  focusRing: [86, 90, 108],
  danger: [220, 80, 80],
  disabledBg: [34, 36, 44],
  disabledFg: [96, 100, 114],
};

/** Build a complete theme while preserving the shared defaults for omitted roles. */
export function createTheme(overrides: Partial<Theme> = {}): Theme {
  return { ...defaultTheme, ...overrides };
}

// What a Style color field accepts: a theme token (a key of Theme), an explicit
// RGB/RGBA tuple, or a CSS string ('#rrggbb', 'red', 'transparent'). `keyof
// Theme` is a subset of string — it's listed for documentation/autocomplete.
export type ColorToken = keyof Theme | RGB | RGBA | string;

// Resolve a token to RGBA. Bare strings are looked up as theme keys first, then
// parsed as CSS; tuples pass through parseColor.
export function resolveColor(tok: ColorToken, theme: Theme = defaultTheme): RGBA {
  if (typeof tok === 'string') {
    if (tok in theme) return parseColor(theme[tok as keyof Theme]);
    return parseColor(tok);
  }
  return parseColor(tok);
}
