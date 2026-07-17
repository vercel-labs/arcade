// The two button treatments that actually work on a terminal cell grid, as
// reusable factories. A cell holds ONE background color + one glyph, which forces
// the split:
//
//   • rounded — an arc border (╭╮╰╯) with a TRANSPARENT fill. A background can't
//     stay inside a rounded corner cell (the fill squares off the arc), so the
//     active state recolors the ink instead of filling: label + border go white
//     and the label bolds. Needs a box ≥3 rows tall so the top/bottom border and
//     the content row all fit.
//
//   • filled — a solid background pill with SQUARE corners. A filled cell can't
//     round, so this treatment leans into square and exposes every color/state so
//     the same helper covers neutral, primary, and destructive pills from any file.
//
// Both return a `Style`; pass it to Button({ style }). The *Button wrappers below
// bundle the node + style for the common case.

import type { KeyEvent } from '../platform/input.ts';
import { Button } from './nodes.ts';
import type { ColorToken } from './theme.ts';
import type { Node, Padding, Style } from './types.ts';

const WHITE: ColorToken = [255, 255, 255];
const NEUTRAL_FG: ColorToken = [212, 214, 224];

export interface RoundedButtonStyleOpts {
  color?: ColorToken; // label + border at rest
  borderColor?: ColorToken; // border at rest (defaults to `color`)
  activeColor?: ColorToken; // explicit hover/focus color; omit for the default hue-brighten
  bold?: boolean; // bold the label at rest too (default false — it always bolds when active)
  padding?: Padding; // default [0, 3] — the shared rounded-button horizontal padding
}

// Lerp a concrete RGB(A) color toward white by `t` (0 = unchanged, 1 = white). Theme
// tokens / named colors can't be math'd on, so they pass through unchanged.
function lift(c: ColorToken, t: number): ColorToken {
  if (!Array.isArray(c)) return c;
  const up = (v: number): number => Math.round(v + (255 - v) * t);
  return (c.length === 4 ? [up(c[0]), up(c[1]), up(c[2]), c[3]] : [up(c[0]), up(c[1]), up(c[2])]) as ColorToken;
}

// Outlined rounded button. Hover/focus keep the button's own hue but brighten it — the
// label a little, the border a bit more so the outline pops (the arc glyphs can't be
// thickened) — and bold the label; pressed flashes full white. No fill (see file header).
// Pass `activeColor` to override the hover color with an explicit one instead.
export function roundedButtonStyle(o: RoundedButtonStyleOpts = {}): Style {
  const rest = o.color ?? NEUTRAL_FG;
  const borderRest = o.borderColor ?? rest;
  const lit: Partial<Style> = o.activeColor
    ? { color: o.activeColor, borderColor: o.activeColor, bold: true }
    : { color: lift(rest, 0.3), borderColor: lift(borderRest, 0.5), bold: true };
  return {
    padding: o.padding ?? [0, 3],
    border: 'round',
    color: rest,
    borderColor: borderRest,
    bold: o.bold ?? false,
    hover: lit,
    focus: lit,
    pressed: { color: WHITE, borderColor: WHITE, bold: true },
  };
}

export interface FilledButtonStyleOpts {
  background?: ColorToken;
  color?: ColorToken;
  bold?: boolean; // default true
  padding?: Padding; // default [0, 2]
  // Per-state overlays (shallow-merged over the base at paint time). Omit one to
  // take the neutral default; pass your own to fully control that state.
  hover?: Partial<Style>;
  focus?: Partial<Style>;
  pressed?: Partial<Style>;
}

// Filled square button. Defaults match the app's neutral pill; override any field
// (or a whole state overlay) from the call site to build primary/destructive/etc.
export function filledButtonStyle(o: FilledButtonStyleOpts = {}): Style {
  return {
    padding: o.padding ?? [0, 2],
    background: o.background ?? [44, 46, 56],
    color: o.color ?? NEUTRAL_FG,
    bold: o.bold ?? true,
    hover: o.hover ?? { background: [238, 240, 248], color: [16, 16, 24] },
    focus: o.focus ?? { background: [86, 90, 108], color: [248, 248, 252] },
    pressed: o.pressed ?? { background: [255, 255, 255], color: [12, 12, 18] },
  };
}

interface ButtonProps {
  id: string;
  label: string;
  onClick?: () => void;
  onKey?: (ev: KeyEvent) => boolean;
  // Extra style merged LAST, over the generated treatment — for layout tweaks
  // (margin, width, alignSelf) or one-off overrides without leaving the helper.
  style?: Style;
}

// A rounded (outlined) button: Button + roundedButtonStyle in one call.
export function RoundedButton(o: ButtonProps & RoundedButtonStyleOpts): Node {
  return Button({ id: o.id, label: o.label, onClick: o.onClick, onKey: o.onKey, style: { ...roundedButtonStyle(o), ...o.style } });
}

// A filled (square) button: Button + filledButtonStyle in one call.
export function FilledButton(o: ButtonProps & FilledButtonStyleOpts): Node {
  return Button({ id: o.id, label: o.label, onClick: o.onClick, onKey: o.onKey, style: { ...filledButtonStyle(o), ...o.style } });
}
