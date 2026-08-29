// A vertical list with one row selected. Persistent selectedIndex + scroll live
// on the instance (survive the per-frame rebuild). ↑/k and ↓/j move; Enter
// chooses. Rendered declaratively as a column of Text rows — the selected row
// gets a highlight style, brighter while focused.

import type { Surface } from '../../engine/surface.ts';
import type { KeyEvent } from '../../platform/input.ts';
import type { Component } from '../component.ts';
import { Box, Text } from '../nodes.ts';
import { wrapText } from '../text.ts';
import type { Theme } from '../theme.ts';
import type { LayoutBox, Node, PointerHit, Style } from '../types.ts';

interface VLine {
  item: number;
  text: string;
}

// A hanging indent: the item's own leading `hangingIndent` cells stay on row one,
// and continuation rows are padded to line up under them. The wrapping itself is
// shared; only the prefix bookkeeping is local, since it's presentation.
function wrapIndented(text: string, width: number, hangingIndent = 0): string[] {
  if (width <= 0) return [text];
  const indent = Math.max(0, Math.min(hangingIndent, text.length));
  const prefix = text.slice(0, indent);
  const continuation = ' '.repeat(indent);
  const lines = wrapText(text.slice(indent), Math.max(1, width - indent));
  return lines.map((part, index) => (index === 0 ? prefix : continuation) + part);
}

export interface SelectOpts {
  id: string;
  items: string[];
  height?: number; // visible rows, default = items.length (no scroll)
  width?: number; // fixed width, default 'auto'
  wrap?: boolean; // wrap long items across visual rows, default false
  wrapIndent?: number; // fixed leading cells repeated on continuation lines
  index?: number;
  onChange?: (index: number, item: string) => void;
  onSelect?: (index: number, item: string) => void;
}

export class Select implements Component {
  id: string;
  index: number;
  items: string[];
  private height: number;
  private scroll = 0;
  private focused = false;
  private opts: SelectOpts;

  constructor(opts: SelectOpts) {
    this.id = opts.id;
    this.opts = opts;
    this.items = opts.items;
    this.index = opts.index ?? 0;
    this.height = opts.height ?? opts.items.length;
  }

  // Replace the list contents, resetting the selection + scroll to the top. Used
  // when a dependent select repopulates (e.g. models after the provider changes).
  setItems(items: string[]): void {
    this.items = items;
    this.index = 0;
    this.scroll = 0;
  }

  // Programmatic selection keeps a preselected item inside the visible viewport.
  setIndex(index: number): void {
    if (this.items.length === 0) {
      this.index = 0;
      this.scroll = 0;
      return;
    }
    this.index = Math.max(0, Math.min(this.items.length - 1, index));
    this.keepSelectionVisible();
  }

  private visualLines(): VLine[] {
    if (!this.opts.wrap || typeof this.opts.width !== 'number') {
      return this.items.map((text, item) => ({ item, text }));
    }
    const make = (width: number): VLine[] =>
      this.items.flatMap((text, item) => wrapIndented(text, width, this.opts.wrapIndent ?? 0).map((line) => ({ item, text: line })));
    let lines = make(Math.max(1, this.opts.width - 2)); // horizontal row padding
    if (lines.length > this.height) lines = make(Math.max(1, this.opts.width - 3)); // scrollbar
    return lines;
  }

  private maxScroll(lines = this.visualLines()): number {
    return Math.max(0, lines.length - this.height);
  }

  private keepSelectionVisible(): void {
    const lines = this.visualLines();
    let first = lines.findIndex((line) => line.item === this.index);
    if (first < 0) {
      this.scroll = 0;
      return;
    }
    let last = first;
    while (last + 1 < lines.length && lines[last + 1].item === this.index) last++;
    if (first < this.scroll) this.scroll = first;
    else if (last >= this.scroll + this.height) this.scroll = last - this.height + 1;
    this.scroll = Math.max(0, Math.min(this.maxScroll(lines), Math.min(this.scroll, first)));
  }

  onFocus(): void {
    this.focused = true;
  }
  onBlur(): void {
    this.focused = false;
  }

  private move(delta: number): void {
    const n = this.items.length;
    if (n === 0) return;
    this.index = Math.max(0, Math.min(n - 1, this.index + delta));
    this.keepSelectionVisible();
    this.opts.onChange?.(this.index, this.items[this.index]);
  }

  onKey(ev: KeyEvent): boolean {
    if (ev.name === 'up' || ev.name === 'k') this.move(-1);
    else if (ev.name === 'down' || ev.name === 'j') this.move(1);
    else if (ev.name === 'enter' || ev.name === 'space') this.opts.onSelect?.(this.index, this.items[this.index]);
    else return false;
    return true;
  }

  // Mouse: wheel scrolls the selection; click/drag highlights the row under the
  // cursor, and a click (down) commits it (onSelect), like clicking a menu item.
  onMouse(ev: PointerHit): boolean {
    if (ev.type === 'wheel') {
      this.move(ev.wheel === -1 ? -1 : 1);
      return true;
    }
    const lines = this.visualLines();
    const maxScroll = this.maxScroll(lines);
    if (maxScroll > 0 && ev.x >= ev.w - 1) {
      const frac = ev.h > 1 ? ev.y / (ev.h - 1) : 0;
      this.scroll = Math.round(Math.max(0, Math.min(1, frac)) * maxScroll);
      return true;
    }
    const line = lines[this.scroll + ev.y];
    if (line) {
      this.index = line.item;
      this.opts.onChange?.(this.index, this.items[this.index]);
      if (ev.type === 'down') this.opts.onSelect?.(this.index, this.items[this.index]);
    }
    return true;
  }

  // Draw the track in the list's rightmost cell so it stays flush with its container.
  private paintBar(surf: Surface, box: LayoutBox, theme: Theme): void {
    const lines = this.visualLines();
    const maxScroll = this.maxScroll(lines);
    if (maxScroll === 0) return;
    const x = box.x + box.w - 1;
    const thumb = Math.max(1, Math.round((this.height / lines.length) * box.h));
    const span = box.h - thumb;
    const top = box.y + Math.round((this.scroll / maxScroll) * span);
    for (let y = box.y; y < box.y + box.h; y++) {
      const color = y >= top && y < top + thumb ? theme.scrollbarThumb : theme.scrollbarTrack;
      surf.setCell(x, y, ' ', color, color);
    }
  }

  build(): Node {
    const rows: Node[] = [];
    const lines = this.visualLines();
    const maxScroll = this.maxScroll(lines);
    this.scroll = Number.isFinite(this.scroll)
      ? Math.max(0, Math.min(maxScroll, Math.floor(this.scroll)))
      : 0;
    const overflow = maxScroll > 0;
    const rowWidth =
      typeof this.opts.width === 'number' && overflow ? Math.max(1, this.opts.width - 1) : this.opts.width;
    const end = Math.min(lines.length, this.scroll + this.height);
    for (let lineIndex = this.scroll; lineIndex < end; lineIndex++) {
      const line = lines[lineIndex];
      const selected = line.item === this.index;
      const style: Style = {
        width: rowWidth,
        padding: [0, 1],
        color: selected ? (this.focused ? 'controlHoverFg' : 'textPrimary') : 'textMuted',
        // Selected row = near-white like a hovered bar button (not the blue accent).
        background: selected ? (this.focused ? 'controlHoverBg' : 'controlFocusBg') : 'transparent',
      };
      rows.push(Text({ text: line.text, style }));
    }
    return {
      ...Box({ flexDirection: 'column', alignItems: 'stretch', width: this.opts.width }, rows),
      id: this.id,
      focusable: true,
      onKey: (ev) => this.onKey(ev),
      onMouse: (ev) => this.onMouse(ev),
      draw: (surf, box, theme) => this.paintBar(surf, box, theme),
    };
  }
}
