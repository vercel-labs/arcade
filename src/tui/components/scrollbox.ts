// A fixed-height viewport over a taller list of text rows, with a persistent
// scroll offset. ↑/↓ scroll by one, PageUp/PageDown by a viewport. Only the
// visible slice is built each frame (viewport culling), and a slim scrollbar is
// hand-drawn on the right edge via the FrameBuffer hook to show position.

import { type RGB } from '../../engine/index.ts';
import type { Surface } from '../../engine/index.ts';
import type { KeyEvent } from '../../platform/input.ts';
import type { Component } from '../component.ts';
import { Box, Text } from '../nodes.ts';
import { defaultTheme } from '../theme.ts';
import type { LayoutBox, Node, PointerHit } from '../types.ts';

// A row is either a plain string (rendered as a single fg-colored line) or a
// pre-built Node, letting a caller mix colors within a row (e.g. the chess move
// panel paints illegal moves red). Node rows are responsible for their own width.
export type Row = string | Node;

export interface ScrollBoxOpts {
  id: string;
  rows: Row[];
  height: number; // visible rows — a hard cap; with autoHeight it's the MAX height
  width?: number;
  // Grow with content: the box is only as tall as its rows until it reaches
  // `height`, then it caps there and the scrollbar appears. Off (default) = always
  // `height` rows tall (a fixed viewport), even when there are fewer/no rows.
  autoHeight?: boolean;
}

const TRACK: RGB = defaultTheme.pillBg;
const THUMB: RGB = defaultTheme.accent;
const WHEEL_STEP = 3; // rows scrolled per wheel notch (1 felt sluggish)

export class ScrollBox implements Component {
  id: string;
  scroll = 0;
  rows: Row[];
  private height: number;
  private opts: ScrollBoxOpts;

  constructor(opts: ScrollBoxOpts) {
    this.id = opts.id;
    this.opts = opts;
    this.rows = opts.rows;
    this.height = opts.height;
  }

  // Rows actually shown: the full list until it reaches the cap (autoHeight), then
  // the cap. Fixed mode always shows `height` rows (the classic viewport).
  private visibleHeight(): number {
    return this.opts.autoHeight ? Math.min(this.rows.length, this.height) : this.height;
  }

  private maxScroll(): number {
    return Math.max(0, this.rows.length - this.visibleHeight());
  }

  private scrollBy(delta: number): void {
    this.scroll = Math.max(0, Math.min(this.maxScroll(), this.scroll + delta));
  }

  onKey(ev: KeyEvent): boolean {
    // Don't swallow scroll keys when there's nothing to scroll — let them fall
    // through (e.g. to camera pan) so a short/empty panel isn't a dead zone.
    if (this.maxScroll() === 0) return false;
    if (ev.name === 'up' || ev.name === 'k') this.scrollBy(-1);
    else if (ev.name === 'down' || ev.name === 'j') this.scrollBy(1);
    else if (ev.name === 'pageup') this.scrollBy(-this.visibleHeight());
    else if (ev.name === 'pagedown') this.scrollBy(this.visibleHeight());
    else return false;
    return true;
  }

  // Mouse: wheel scrolls a few rows per notch; click/drag on the scrollbar column
  // (rightmost cell) jumps the scroll position proportional to the y within it.
  onMouse(ev: PointerHit): boolean {
    if (ev.type === 'wheel') {
      if (this.maxScroll() === 0) return false; // nothing to scroll — don't consume
      this.scrollBy(ev.wheel === -1 ? -WHEEL_STEP : WHEEL_STEP);
      return true;
    }
    if (ev.x >= ev.w - 1) {
      const frac = ev.h > 1 ? ev.y / (ev.h - 1) : 0;
      this.scroll = Math.max(0, Math.min(this.maxScroll(), Math.round(frac * this.maxScroll())));
    }
    return true;
  }

  // Slim scrollbar in the rightmost column: a track with a proportional thumb.
  // Painted via cell BACKGROUNDS (a space glyph) rather than block characters, so
  // stacked cells form one solid, gapless bar — a foreground '█' can show thin
  // line-spacing seams between rows in many terminals.
  private paintBar(surf: Surface, box: LayoutBox): void {
    const total = this.rows.length;
    const vh = this.visibleHeight();
    if (total <= vh) return; // nothing to scroll
    const x = box.x + box.w - 1;
    const thumb = Math.max(1, Math.round((vh / total) * box.h));
    const span = box.h - thumb;
    const top = box.y + (this.maxScroll() === 0 ? 0 : Math.round((this.scroll / this.maxScroll()) * span));
    for (let y = box.y; y < box.y + box.h; y++) {
      const color = y >= top && y < top + thumb ? THUMB : TRACK;
      surf.setCell(x, y, ' ', color, color);
    }
  }

  build(): Node {
    const vh = this.visibleHeight();
    const end = Math.min(this.rows.length, this.scroll + vh);
    const lines: Node[] = [];
    for (let i = this.scroll; i < end; i++) {
      const row = this.rows[i];
      lines.push(typeof row === 'string' ? Text({ text: row, style: { color: 'fg', width: this.opts.width } }) : row);
    }
    return {
      ...Box(
        { flexDirection: 'column', alignItems: 'stretch', width: this.opts.width, height: vh, overflow: 'hidden' },
        lines,
      ),
      id: this.id,
      focusable: true,
      onKey: (ev) => this.onKey(ev),
      onMouse: (ev) => this.onMouse(ev),
      draw: (surf, b) => this.paintBar(surf, b),
    };
  }
}
