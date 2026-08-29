// A node that hands you a rectangular region of cells to draw into imperatively
// (setCell / drawText / fillRect / blendRect), instead of describing it with
// Box/Text. The flex engine positions and sizes the rect; `draw` fills it. This
// is the escape hatch for anything that isn't boxes-and-text — a sparkline, a
// minimap, a half-block sprite, or (eventually) the 3D scene as a tree node.
//
// Stateless by itself: persistent pixels live in whatever the `draw` closure
// captures. Wrap it in a Component when the drawing has state that must survive
// the per-frame rebuild.

import type { Surface } from '../../engine/surface.ts';
import type { Dimension, LayoutBox, Node, Style } from '../types.ts';

export type FrameDraw = (surf: Surface, box: LayoutBox) => void;

export function FrameBuffer(opts: {
  draw: FrameDraw;
  id?: string;
  width?: Dimension;
  height?: Dimension;
  focusable?: boolean;
  style?: Style;
}): Node {
  return {
    kind: 'box',
    id: opts.id,
    focusable: opts.focusable,
    style: { width: opts.width, height: opts.height, ...opts.style },
    draw: opts.draw,
  };
}
