// Hover tooltip decorator. It owns the trigger's hover affordance and leaves
// positioning/painting to the shared final tooltip pass in paint.ts.

import type { Node, Style, TooltipContent, TooltipPlacement, TooltipSpec } from '../types.ts';

const DEFAULT_HOVER: Partial<Style> = {
  background: 'controlHoverBg',
  color: 'controlHoverFg',
  bold: true,
};

export interface TooltipOpts extends Omit<TooltipSpec, 'content'> {
  id?: string;
  content: TooltipContent;
  hover?: Partial<Style>;
}

export function Tooltip(opts: TooltipOpts, trigger: Node): Node {
  const id = trigger.id ?? opts.id;
  if (!id) throw new Error('Tooltip trigger needs an id (on the node or in Tooltip options)');
  const placement: TooltipPlacement = opts.placement ?? 'auto';
  return {
    ...trigger,
    id,
    hoverable: true,
    tooltip: {
      content: opts.content,
      maxWidth: opts.maxWidth,
      placement,
      gap: opts.gap,
      padding: opts.padding,
      background: opts.background,
      color: opts.color,
      arrow: opts.arrow,
    },
    style: {
      ...trigger.style,
      hover: {
        ...DEFAULT_HOVER,
        ...trigger.style.hover,
        ...opts.hover,
      },
    },
  };
}
