// Places cell UI around a projected scene anchor. Projection itself stays in the engine;
// this component owns terminal-cell rounding and absolute TUI positioning. It is an ordinary
// layout node, not a TUI overlay/portal, so sibling paint and hit order remain caller-controlled.

import type { Node, Style } from '../types.ts';
import { Box } from '../nodes.ts';

export type AnchorAlignment = 'start' | 'center' | 'end';

export interface ProjectedAnchorOptions {
  col: number;
  row: number;
  width: number;
  height?: number;
  alignX?: AnchorAlignment;
  alignY?: AnchorAlignment;
  style?: Style;
}

function alignedOrigin(anchor: number, extent: number, alignment: AnchorAlignment): number {
  if (alignment === 'start') return anchor;
  if (alignment === 'end') return anchor - extent + 1;
  return anchor - Math.floor(extent / 2);
}

/** An absolutely positioned box aligned to one projected terminal cell. */
export function ProjectedAnchor(opts: ProjectedAnchorOptions, children: Node[] = []): Node {
  const height = opts.height ?? 1;
  return Box({
    ...opts.style,
    position: 'absolute',
    left: alignedOrigin(opts.col, opts.width, opts.alignX ?? 'center'),
    top: alignedOrigin(opts.row, height, opts.alignY ?? 'start'),
    width: opts.width,
    height,
  }, children);
}
