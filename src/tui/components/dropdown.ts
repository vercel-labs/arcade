// A collapsing single-select (combobox). Unlike Select — which keeps its whole
// list on screen — a Dropdown shows just a one-line "field" with the current
// choice + a caret; focusing it and pressing Enter (or clicking) opens a
// scrollable list below, ↑/↓ move the highlight, Enter/click commits and closes,
// and Esc closes (so does Tabbing away). The list only appears while open, so a
// screen full of choices (a provider + model picker per side) stays calm.
//
// The open list is a `position:absolute` + `overlay` node: out of flow, so it
// neither resizes nor is clipped by its container (it floats over later siblings
// and can extend past the card), and it scrolls — a wheel or a drag on the
// right-edge scrollbar moves the view; ↑/↓ move the highlight and keep it in
// view. Option names too long for the width WRAP onto extra lines (rather than
// truncating); a wrapped item highlights and selects as one block. Persistent
// state (open / committed index / scroll) lives on the instance so it survives
// the per-frame rebuild, like Select/ScrollBox.

import { type RGB } from '../../engine/index.ts';
import type { Surface } from '../../engine/index.ts';
import type { KeyEvent } from '../../platform/input.ts';
import type { Component } from '../component.ts';
import { Box, Text } from '../nodes.ts';
import { type ColorToken, defaultTheme } from '../theme.ts';
import type { LayoutBox, Node, PointerHit, Style } from '../types.ts';

export interface DropdownOpts {
  id: string;
  items: string[];
  width: number; // fixed field/list width (cells)
  rows?: number; // max visible lines when open (the list scrolls past this), default 7
  index?: number; // committed selection, or -1 for none (shows the placeholder)
  placeholder?: string; // field text when nothing is committed, default 'Select…'
  accentColor?: ColorToken; // committed field-text color (e.g. a brand hue), default 'fg'
  onSelect?: (index: number, item: string) => void; // fires on commit (Enter/click)
}

const CARET_CLOSED = '▾';
const CARET_OPEN = '▴';
const TRACK: RGB = defaultTheme.pillBg;
const THUMB: RGB = [150, 154, 170]; // a light gray (not the blue accent)
const WHEEL_STEP = 3; // lines per wheel notch (matches ScrollBox)

// One rendered line of the open list: which item it belongs to, and its text
// fragment. A long item name spans several consecutive lines with the same `item`.
interface VLine {
  item: number;
  text: string;
}

// Word-wrap `text` into pieces no wider than `w`. Greedy; a single word longer
// than `w` is hard-split so nothing ever overflows the column.
function wrapText(text: string, w: number): string[] {
  if (w <= 0) return [text];
  const out: string[] = [];
  let cur = '';
  for (const word of text.split(' ')) {
    if (word.length > w) {
      if (cur) {
        out.push(cur);
        cur = '';
      }
      let rest = word;
      while (rest.length > w) {
        out.push(rest.slice(0, w));
        rest = rest.slice(w);
      }
      cur = rest;
    } else if (cur === '') {
      cur = word;
    } else if (cur.length + 1 + word.length <= w) {
      cur += ' ' + word;
    } else {
      out.push(cur);
      cur = word;
    }
  }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}

export class Dropdown implements Component {
  id: string;
  index: number; // committed selection (-1 = none)
  items: string[];
  open = false;
  private highlight = 0; // ITEM highlighted while open (the pending choice)
  private scroll = 0; // first visible LINE (view offset, independent of highlight)
  private focused = false;
  private width: number;
  private rows: number;
  private lines: VLine[] = []; // items wrapped to the list width, flattened
  private opts: DropdownOpts;

  constructor(opts: DropdownOpts) {
    this.id = opts.id;
    this.opts = opts;
    this.items = opts.items;
    this.width = opts.width;
    this.rows = opts.rows ?? 7;
    this.index = opts.index ?? -1;
    this.relayoutLines();
  }

  // Inner text width of a list row: the width minus the reserved scrollbar gutter
  // (rightmost column) minus the [0,1] horizontal padding.
  private innerWidth(): number {
    return Math.max(1, this.width - 1 - 2);
  }

  // Recompute the wrapped-line model (after items or width change).
  private relayoutLines(): void {
    const w = this.innerWidth();
    const lines: VLine[] = [];
    this.items.forEach((label, item) => {
      for (const text of wrapText(label, w)) lines.push({ item, text });
    });
    this.lines = lines;
  }

  // Replace the list contents (e.g. models after the provider changes): clear the
  // committed selection back to the placeholder and collapse.
  setItems(items: string[]): void {
    this.items = items;
    this.index = -1;
    this.highlight = 0;
    this.scroll = 0;
    this.open = false;
    this.relayoutLines();
  }

  // Committed item's label, or null when nothing is chosen.
  get value(): string | null {
    return this.index >= 0 ? (this.items[this.index] ?? null) : null;
  }

  // The brand/accent field color can change per frame (provider hue); let the
  // owner set it just before build without rebuilding the instance.
  setAccent(color: ColorToken): void {
    this.opts = { ...this.opts, accentColor: color };
  }

  onFocus(): void {
    this.focused = true;
  }
  // Losing focus (Tab away) collapses an open list.
  onBlur(): void {
    this.focused = false;
    this.open = false;
  }
  onPointerDownOutside(): boolean {
    if (!this.open) return false;
    this.open = false;
    return true;
  }

  private maxScroll(): number {
    return Math.max(0, this.lines.length - this.rows);
  }

  private openList(): void {
    this.open = true;
    this.highlight = this.index >= 0 ? this.index : 0;
    this.scrollToHighlight();
  }

  // Keep the highlighted item's lines within the visible window (keyboard nav).
  private scrollToHighlight(): void {
    let first = this.lines.findIndex((l) => l.item === this.highlight);
    if (first < 0) first = 0;
    let last = first;
    while (last + 1 < this.lines.length && this.lines[last + 1].item === this.highlight) last++;
    if (first < this.scroll) this.scroll = first;
    else if (last >= this.scroll + this.rows) this.scroll = last - this.rows + 1;
    this.scroll = Math.max(0, Math.min(this.maxScroll(), Math.min(this.scroll, first)));
  }

  private moveHighlight(delta: number): void {
    const n = this.items.length;
    if (n === 0) return;
    this.highlight = Math.max(0, Math.min(n - 1, this.highlight + delta));
    this.scrollToHighlight();
  }

  // Scroll the view without moving the highlight (wheel / scrollbar drag).
  private scrollBy(delta: number): void {
    this.scroll = Math.max(0, Math.min(this.maxScroll(), this.scroll + delta));
  }

  // Commit a choice: record it, collapse, and notify. Public so the owner (and
  // headless tests) can drive a selection the way Enter/click does.
  pick(i: number): void {
    if (i < 0 || i >= this.items.length) return;
    this.index = i;
    this.open = false;
    this.opts.onSelect?.(i, this.items[i]);
  }

  onKey(ev: KeyEvent): boolean {
    if (!this.open) {
      // Closed: Enter/Space/↓ open the list; ↑ opens too (web-combobox feel).
      if (ev.name === 'enter' || ev.name === 'space' || ev.name === 'down' || ev.name === 'up') {
        this.openList();
        return true;
      }
      return false; // let Esc/Tab/etc. fall through to the app (e.g. modal cancel)
    }
    // Open: navigate by ITEM / commit / dismiss.
    if (ev.name === 'up' || ev.name === 'k') this.moveHighlight(-1);
    else if (ev.name === 'down' || ev.name === 'j') this.moveHighlight(1);
    else if (ev.name === 'pageup') this.scrollBy(-this.rows);
    else if (ev.name === 'pagedown') this.scrollBy(this.rows);
    else if (ev.name === 'enter' || ev.name === 'space') this.pick(this.highlight);
    else if (ev.name === 'escape') this.open = false; // dismiss without committing
    else return false; // Tab and friends pass through (and onBlur collapses us)
    return true;
  }

  // The field's mouse handler: a press toggles the list open/closed.
  private onFieldMouse(ev: PointerHit): boolean {
    if (ev.type === 'down') {
      if (this.open) this.open = false;
      else this.openList();
    }
    return true;
  }

  // The open list's mouse handler (its own overlay node, so coords are local to
  // the list). Wheel scrolls the view; a drag/click on the right-edge scrollbar
  // jumps the view; a click on any line of an item commits that item.
  private onListMouse(ev: PointerHit): boolean {
    if (ev.type === 'wheel') {
      this.scrollBy(ev.wheel === -1 ? -WHEEL_STEP : WHEEL_STEP);
      return true;
    }
    if (ev.x >= this.width - 1 && this.lines.length > this.rows) {
      // Scrollbar column: jump proportional to the cursor's y within the track.
      const frac = ev.h > 1 ? ev.y / (ev.h - 1) : 0;
      this.scroll = Math.max(0, Math.min(this.maxScroll(), Math.round(frac * this.maxScroll())));
      return true;
    }
    const line = this.scroll + ev.y;
    if (line >= 0 && line < this.lines.length) {
      const item = this.lines[line].item;
      this.highlight = item;
      if (ev.type === 'down') this.pick(item);
    }
    return true;
  }

  // Slim scrollbar in the list's rightmost (reserved) column — a gapless
  // cell-background bar — shown only when the list overflows its visible lines.
  private paintBar(surf: Surface, box: LayoutBox): void {
    const total = this.lines.length;
    if (total <= this.rows) return;
    const x = box.x + box.w - 1;
    const thumb = Math.max(1, Math.round((this.rows / total) * box.h));
    const span = box.h - thumb;
    const top = box.y + (this.maxScroll() === 0 ? 0 : Math.round((this.scroll / this.maxScroll()) * span));
    for (let y = box.y; y < box.y + box.h; y++) {
      const color = y >= top && y < top + thumb ? THUMB : TRACK;
      surf.setCell(x, y, ' ', color, color);
    }
  }

  // Fit the committed label into the one-line field, leaving room for the caret.
  private fieldText(): string {
    const inner = this.width - 2; // padding [0,1] eats one cell each side
    const caret = this.open ? CARET_OPEN : CARET_CLOSED;
    const label = this.value ?? this.opts.placeholder ?? 'Select…';
    const room = inner - 2; // 1 gap + 1 caret
    const shown = label.length > room ? `${label.slice(0, room - 1)}…` : label;
    return shown.padEnd(room) + ' ' + caret;
  }

  build(): Node {
    const committed = this.index >= 0;
    const fieldStyle: Style = {
      width: this.width,
      padding: [0, 1],
      bold: true,
      // Gray/white like the bar buttons: muted placeholder, brand/light when set.
      color: committed ? (this.opts.accentColor ?? 'fg') : 'muted',
      // Resting gray; the lighter focus-gray when open or focused (matches buttons).
      background: this.open || this.focused ? 'focusRing' : 'pillBg',
      hover: this.open ? undefined : { background: 'focusRing' },
    };
    // The field is the focusable, id-bearing node (clicking it focuses the
    // dropdown; ↑/↓/Enter route here). The open list is a sibling overlay.
    const field: Node = {
      ...Text({ text: this.fieldText(), style: fieldStyle }),
      id: this.id,
      focusable: true,
      onKey: (ev) => this.onKey(ev),
      onMouse: (ev) => this.onFieldMouse(ev),
    };

    const children: Node[] = [field];
    if (this.open) {
      const visible = Math.min(this.lines.length, this.rows);
      const end = this.scroll + visible;
      const rowW = this.width - 1; // rows stop one short of the reserved scrollbar gutter
      const listRows: Node[] = [];
      for (let li = this.scroll; li < end; li++) {
        const { item, text } = this.lines[li];
        const on = item === this.highlight; // every line of the highlighted item lights up
        listRows.push(
          Text({
            // Selected item reads like a hovered bar button: near-white bg, dark text.
            text,
            style: { width: rowW, padding: [0, 1], color: on ? 'pillHoverFg' : 'fg', background: on ? 'pillHoverBg' : 'pillBg' },
          }),
        );
      }
      // Float the list just below the field (top:1, out of flow → the container
      // keeps its one-row height). Its own bg fills the reserved gutter column
      // when no scrollbar is drawn; it owns the list's mouse + scrollbar.
      children.push({
        ...Box(
          {
            position: 'absolute',
            top: 1,
            left: 0,
            width: this.width,
            height: visible,
            overflow: 'hidden',
            flexDirection: 'column',
            alignItems: 'start',
            background: 'pillBg',
          },
          listRows,
        ),
        overlay: true,
        onMouse: (ev: PointerHit) => this.onListMouse(ev),
        draw: (surf, b) => this.paintBar(surf, b),
      });
    }

    // The wrapper stays one row tall (the field) — the list is out of flow — so a
    // dropdown opening never resizes the modal around it.
    return Box({ flexDirection: 'column', alignItems: 'stretch', width: this.width }, children);
  }
}
