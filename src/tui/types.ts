// Shared types for the TUI layer. A UI is a tree of `Node`s built fresh each
// frame (cheap, like the old currentBar()); per-node interaction state lives in
// the Screen runtime keyed by `id`, so the tree itself stays pure data.

import type { RGB } from '../engine/index.ts';
import type { Key } from '../platform/input.ts';

// A size along one axis: fixed cells, a percentage of the parent's content box,
// or 'auto' (intrinsic — text width for Text, summed children for Box).
export type Dimension = number | { pct: number } | 'auto';

export type FlexDirection = 'row' | 'column';
export type Justify = 'start' | 'center' | 'end' | 'between' | 'around';
export type Align = 'start' | 'center' | 'end' | 'stretch';
// Padding is either uniform, or [vertical, horizontal].
export type Padding = number | [number, number];
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
  flexGrow?: number; // share of leftover main-axis space, default 0
  background?: RGB;
  color?: RGB; // text/foreground color
  border?: BorderStyle;
  borderColor?: RGB;
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

export interface Node {
  kind: Kind;
  id?: string;
  style: Style;
  children?: Node[];
  text?: string; // Text/Button content
  focusable?: boolean;
  onClick?: () => void;
  // Returns true if the key was consumed (stops fall-through to app handlers).
  onKey?: (k: Key) => boolean;
  // Filled by layout(); read by paint and hit-test (one source of truth).
  layout?: LayoutBox;
}
