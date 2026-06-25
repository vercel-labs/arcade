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

export interface ScrollBoxOpts {
  id: string;
  rows: string[];
  height: number; // visible rows
  width?: number;
}

const TRACK: RGB = defaultTheme.pillBg;
const THUMB: RGB = defaultTheme.accent;

export class ScrollBox implements Component {
  id: string;
  scroll = 0;
  rows: string[];
  private height: number;
  private opts: ScrollBoxOpts;

  constructor(opts: ScrollBoxOpts) {
    this.id = opts.id;
    this.opts = opts;
    this.rows = opts.rows;
    this.height = opts.height;
  }

  private maxScroll(): number {
    return Math.max(0, this.rows.length - this.height);
  }

  private scrollBy(delta: number): void {
    this.scroll = Math.max(0, Math.min(this.maxScroll(), this.scroll + delta));
  }

  onKey(ev: KeyEvent): boolean {
    if (ev.name === 'up' || ev.name === 'k') this.scrollBy(-1);
    else if (ev.name === 'down' || ev.name === 'j') this.scrollBy(1);
    else if (ev.name === 'pageup') this.scrollBy(-this.height);
    else if (ev.name === 'pagedown') this.scrollBy(this.height);
    else return false;
    return true;
  }

  // Mouse: wheel scrolls a row at a time; click/drag on the scrollbar column
  // (rightmost cell) jumps the scroll position proportional to the y within it.
  onMouse(ev: PointerHit): boolean {
    if (ev.type === 'wheel') {
      this.scrollBy(ev.wheel === -1 ? -1 : 1);
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
    if (total <= this.height) return; // nothing to scroll
    const x = box.x + box.w - 1;
    const thumb = Math.max(1, Math.round((this.height / total) * box.h));
    const span = box.h - thumb;
    const top = box.y + (this.maxScroll() === 0 ? 0 : Math.round((this.scroll / this.maxScroll()) * span));
    for (let y = box.y; y < box.y + box.h; y++) {
      const color = y >= top && y < top + thumb ? THUMB : TRACK;
      surf.setCell(x, y, ' ', color, color);
    }
  }

  build(): Node {
    const end = Math.min(this.rows.length, this.scroll + this.height);
    const lines: Node[] = [];
    for (let i = this.scroll; i < end; i++) {
      lines.push(Text({ text: this.rows[i], style: { color: 'fg', width: this.opts.width } }));
    }
    return {
      ...Box(
        { flexDirection: 'column', alignItems: 'stretch', width: this.opts.width, height: this.height, overflow: 'hidden' },
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
