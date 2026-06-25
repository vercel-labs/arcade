// A vertical list with one row selected. Persistent selectedIndex + scroll live
// on the instance (survive the per-frame rebuild). ↑/k and ↓/j move; Enter
// chooses. Rendered declaratively as a column of Text rows — the selected row
// gets a highlight style, brighter while focused.

import type { KeyEvent } from '../../platform/input.ts';
import type { Component } from '../component.ts';
import { Box, Text } from '../nodes.ts';
import type { Node, PointerHit, Style } from '../types.ts';

export interface SelectOpts {
  id: string;
  items: string[];
  height?: number; // visible rows, default = items.length (no scroll)
  width?: number; // fixed width, default 'auto'
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
    if (this.index < this.scroll) this.scroll = this.index;
    else if (this.index >= this.scroll + this.height) this.scroll = this.index - this.height + 1;
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
    const row = this.scroll + ev.y;
    if (row >= 0 && row < this.items.length) {
      this.index = row;
      this.opts.onChange?.(this.index, this.items[this.index]);
      if (ev.type === 'down') this.opts.onSelect?.(this.index, this.items[this.index]);
    }
    return true;
  }

  build(): Node {
    const rows: Node[] = [];
    const end = Math.min(this.items.length, this.scroll + this.height);
    for (let i = this.scroll; i < end; i++) {
      const selected = i === this.index;
      const style: Style = {
        width: this.opts.width,
        padding: [0, 1],
        color: selected ? (this.focused ? 'pillHoverFg' : 'fg') : 'muted',
        background: selected ? (this.focused ? 'accent' : 'focusRing') : 'transparent',
      };
      rows.push(Text({ text: this.items[i], style }));
    }
    return {
      ...Box({ flexDirection: 'column', alignItems: 'stretch', width: this.opts.width }, rows),
      id: this.id,
      focusable: true,
      onKey: (ev) => this.onKey(ev),
      onMouse: (ev) => this.onMouse(ev),
    };
  }
}
