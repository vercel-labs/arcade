// Shared geometry for game HUD chrome that must stay clear of an optional right rail.
// Callers supply game-specific buttons and banner content; this owns only placement.

import { Box, type Node } from '../../tui/index.ts';

export function hudTopRight(children: Node[], opts: { railWidth?: number; top?: number; right?: number; gap?: number } = {}): Node {
  return Box({ position: 'absolute', top: opts.top ?? 1, right: (opts.right ?? 2) + (opts.railWidth ?? 0), flexDirection: 'row', gap: opts.gap ?? 1 }, children);
}

export function hudTopCenter(content: Node, screenWidth: number, opts: { railWidth?: number; top?: number } = {}): Node {
  return Box({ position: 'absolute', top: opts.top ?? 1, left: 0, width: Math.max(0, screenWidth - (opts.railWidth ?? 0)), flexDirection: 'row', justifyContent: 'center' }, [content]);
}

export function hudBottomRight(content: Node, opts: { railWidth?: number; bottom?: number; right?: number } = {}): Node {
  return Box({ position: 'absolute', bottom: opts.bottom ?? 1, right: (opts.right ?? 2) + (opts.railWidth ?? 0) }, [content]);
}
