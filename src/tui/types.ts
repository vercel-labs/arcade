// Shared types for the TUI layer. A UI is a tree of `Node`s built fresh each
// frame (cheap, like the old currentBar()); per-node interaction state lives in
// the Screen runtime keyed by `id`, so the tree itself stays pure data.

import type { Surface } from '../engine/surface.ts';
import type { KeyEvent } from '../platform/input.ts';
import type { ColorToken, Theme } from './theme.ts';

// A size along one axis: fixed cells, a percentage of the parent's content box,
// or 'auto' (intrinsic — text width for Text, summed children for Box).
export type Dimension = number | { pct: number } | 'auto';

export type FlexDirection = 'row' | 'column';
export type Justify = 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly';
export type Align = 'start' | 'center' | 'end' | 'stretch';
// Box spacing: uniform, [vertical, horizontal], or [top, right, bottom, left].
export type Spacing = number | [number, number] | [number, number, number, number];
export type Padding = Spacing;
export type Position = 'relative' | 'absolute';
export type Overflow = 'visible' | 'hidden';
// What to do with Text/Button content wider than its own content box, named after
// the CSS property. Opt-in: without it text overflows its box and is clipped only
// by an ancestor's overflow:hidden, which is what most of the app still relies on.
export type TextOverflow = 'clip' | 'ellipsis';
export type BorderStyle = 'none' | 'square' | 'round';

// A tooltip is deliberately data on its trigger rather than a hidden child in
// the layout tree. The painter only materializes the active tooltip, after all
// portal overlays, so it cannot resize its trigger or intercept pointer input.
export interface TooltipText {
  text: string;
  bold?: boolean;
  color?: ColorToken;
}

export type TooltipContent = string | readonly (string | TooltipText)[];
export type TooltipPlacement = 'top' | 'bottom' | 'auto';

export interface TooltipSpec {
  content: TooltipContent;
  maxWidth?: number;
  placement?: TooltipPlacement;
  gap?: number;
  padding?: Padding;
  background?: ColorToken;
  color?: ColorToken;
  arrow?: boolean;
}

export interface Style {
  width?: Dimension;
  height?: Dimension;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  flexDirection?: FlexDirection; // default 'row'
  justifyContent?: Justify; // main-axis distribution, default 'start'
  alignItems?: Align; // cross-axis placement, default 'start'
  gap?: number; // cells between children
  padding?: Padding;
  margin?: Spacing; // outer spacing; participates in flex sizing/positioning
  flexGrow?: number; // share of leftover main-axis space, default 0
  flexShrink?: number; // share of overflow to absorb, default 1 (0 = never shrink)
  flexBasis?: number; // initial main-axis size before grow/shrink (overrides width/height intrinsic)
  // Out-of-flow positioning against the nearest ancestor's content box.
  position?: Position; // default 'relative'
  top?: Dimension;
  left?: Dimension;
  right?: Dimension;
  bottom?: Dimension;
  overflow?: Overflow; // 'hidden' clips descendants to this node's content box
  background?: ColorToken; // theme token, RGB/RGBA tuple, CSS string, or 'transparent'
  // Like a translucent background, but blends over the cells ALREADY in the
  // Surface (the scene) keeping their glyphs — a real dim, not a flat fill.
  // Used for modal scrims (needs the unified compositing path).
  scrim?: ColorToken;
  color?: ColorToken; // text/foreground color
  border?: BorderStyle;
  borderColor?: ColorToken;
  bold?: boolean;
  dim?: boolean;
  underline?: boolean;
  // Fit Text/Button content to this node's content box (see TextOverflow). Needs a
  // resolved width to measure against, so it's inert on an 'auto'-width node —
  // which is sized to its text and therefore never overflows anyway.
  textOverflow?: TextOverflow;
  // State overlays merged over the base style at paint time.
  hover?: Partial<Style>;
  focus?: Partial<Style>;
  pressed?: Partial<Style>;
  // Applied when the node sets `disabled`, INSTEAD of the three above — a control
  // that does nothing must not light up when the pointer crosses it.
  disabled?: Partial<Style>;
  // `none` makes this node and its descendants purely visual: pointer hover,
  // presses, wheels, and hover-scroll keys pass through to whatever is behind
  // the subtree. Useful for projected scene labels that paint an opaque badge
  // without becoming an invisible interaction blocker.
  pointerEvents?: 'auto' | 'none';
}

// Absolute cell rectangle filled in by the layout pass.
export interface LayoutBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Kind = 'box' | 'text' | 'button';

// A mouse event delivered to a node's onMouse, in coordinates LOCAL to the
// node's layout box (top-left = 0,0), plus the box size so a component can map
// the hit to a row / track position / scrollbar without knowing its own layout.
export interface PointerHit {
  type: 'down' | 'drag' | 'wheel';
  x: number;
  y: number;
  w: number;
  h: number;
  wheel?: -1 | 1; // for type 'wheel': -1 = up, +1 = down
  // SGR button held: 0 = left, 1 = middle, 2 = right. A drag reports the button
  // its down captured with. Callers that don't forward one are read as left.
  button?: number;
}

export interface Node {
  kind: Kind;
  id?: string;
  style: Style;
  children?: Node[];
  text?: string; // Text/Button content
  focusable?: boolean;
  // Inert: no clicks, no hover/focus/pressed styling, skipped by Tab. Mirrors the DOM
  // attribute — `focusable` still describes what the control IS, so re-enabling it
  // doesn't have to restore anything. The node keeps absorbing pointer gestures, so a
  // click on a dead button doesn't fall through and drag the scene behind it.
  disabled?: boolean;
  // Opt into hover hit-testing without also making the node clickable or
  // keyboard-focusable. Tooltip() sets this for passive and disabled controls.
  hoverable?: boolean;
  tooltip?: TooltipSpec;
  onClick?: () => void;
  // Returns true if the key was consumed (stops fall-through to app handlers).
  onKey?: (ev: KeyEvent) => boolean;
  // Mouse interaction with local coordinates (click/drag/wheel). A down captures
  // the pointer so subsequent drags route here even off the node. Returns true if
  // consumed (so the caller doesn't also treat it as a scene gesture).
  onMouse?: (ev: PointerHit) => boolean;
  // Filled by layout(); read by paint and hit-test (one source of truth).
  layout?: LayoutBox;
  // Filled by layout() when an ancestor sets overflow:hidden — the rect this
  // node's painting and hit-testing are clipped to (undefined = no clip).
  clip?: LayoutBox;
  // Marks this node as a Slot for a persistent Component (the id). Before layout
  // the Screen replaces its children with the live instance's build() output, so
  // the component's state survives the per-frame tree rebuild.
  component?: string;
  // FrameBuffer escape hatch: hand-draw into this node's content box. Called by
  // paint after the node's own bg/border, clipped to the node. The box is the
  // content rect (inside border + padding), in absolute Surface cells.
  draw?: (surf: Surface, box: LayoutBox, theme: Theme) => void;
  // Portal: paint this subtree LAST (above everything) and hit-test it FIRST, so
  // it floats over later siblings — a dropdown list, popover, tooltip. Pair with
  // position:'absolute' so it's out of flow and doesn't resize its container; it
  // can then extend past the container's bounds. Laid out in place like any node.
  overlay?: boolean;
}
