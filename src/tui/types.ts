// Shared types for the TUI layer. A UI is a tree of `Node`s built fresh each
// frame (cheap, like the old currentBar()); per-node interaction state lives in
// the Screen runtime keyed by `id`, so the tree itself stays pure data.

import type { Surface } from '../engine/index.ts';
import type { KeyEvent } from '../platform/input.ts';
import type { ColorToken } from './theme.ts';

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
export type BorderStyle = 'none' | 'square' | 'round';

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
  // State overlays merged over the base style at paint time.
  hover?: Partial<Style>;
  focus?: Partial<Style>;
  pressed?: Partial<Style>;
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
  draw?: (surf: Surface, box: LayoutBox) => void;
  // Portal: paint this subtree LAST (above everything) and hit-test it FIRST, so
  // it floats over later siblings — a dropdown list, popover, tooltip. Pair with
  // position:'absolute' so it's out of flow and doesn't resize its container; it
  // can then extend past the container's bounds. Laid out in place like any node.
  overlay?: boolean;
}
