// Semantic color tokens. Components reference token names (or explicit colors);
// resolveColor maps a token to a concrete RGBA at paint time. One place to
// retheme the whole UI instead of scattering literals through component styles.

import { parseColor, type RGB, type RGBA } from '../engine/index.ts';

export interface Theme {
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
}

export const defaultTheme: Theme = {
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
};

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
