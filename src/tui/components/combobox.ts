// A searchable single-select field: text entry filters a floating list while a
// separate chevron toggles it. The committed value and live query are distinct,
// so clearing a search restores the selected label. State lives on the component
// instance and survives the UI tree being rebuilt each frame.

import { type RGB } from '../../engine/index.ts';
import type { Surface } from '../../engine/index.ts';
import type { KeyEvent } from '../../platform/input.ts';
import type { Component } from '../component.ts';
import { Box, Text } from '../nodes.ts';
import { type ColorToken, defaultTheme } from '../theme.ts';
import type { LayoutBox, Node, PointerHit, Style } from '../types.ts';

export interface ComboboxOpts {
  id: string;
  items: string[];
  width: number;
  rows?: number;
  index?: number;
  placeholder?: string;
  emptyLabel?: string;
  accentColor?: ColorToken;
  onSelect?: (index: number, item: string) => void;
  onQueryChange?: (query: string) => void;
}

interface Match {
  item: number;
  label: string;
}

interface VLine {
  match: number;
  text: string;
}

const TRACK: RGB = defaultTheme.pillBg;
const THUMB: RGB = [150, 154, 170];
const WHEEL_STEP = 3;
const CURSOR: RGB = [131, 165, 152]; // #83A598
const CURSOR_FG: RGB = [12, 18, 24];

function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [text];
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (word.length > width) {
      if (line) lines.push(line);
      let rest = word;
      while (rest.length > width) {
        lines.push(rest.slice(0, width));
        rest = rest.slice(width);
      }
      line = rest;
    } else if (!line) line = word;
    else if (line.length + word.length + 1 <= width) line += ' ' + word;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function charClass(char: string): 'space' | 'word' | 'punct' {
  if (/\s/.test(char)) return 'space';
  if (/[\p{L}\p{N}_]/u.test(char)) return 'word';
  return 'punct';
}

function previousWord(text: string, from: number): number {
  let i = Math.max(0, Math.min(text.length, from));
  while (i > 0 && charClass(text[i - 1]) === 'space') i--;
  if (i === 0) return 0;
  const kind = charClass(text[i - 1]);
  while (i > 0 && charClass(text[i - 1]) === kind) i--;
  return i;
}

function nextWord(text: string, from: number): number {
  let i = Math.max(0, Math.min(text.length, from));
  while (i < text.length && charClass(text[i]) === 'space') i++;
  if (i === text.length) return i;
  const kind = charClass(text[i]);
  while (i < text.length && charClass(text[i]) === kind) i++;
  while (i < text.length && charClass(text[i]) === 'space') i++;
  return i;
}

export class Combobox implements Component {
  id: string;
  items: string[];
  index: number;
  open = false;
  query = '';
  caret = 0;

  private focused = false;
  private activated = false;
  private editing = false;
  private queryScroll = 0;
  private highlight = 0;
  private scroll = 0;
  private matches: Match[] = [];
  private lines: VLine[] = [];
  private readonly width: number;
  private readonly rows: number;
  private opts: ComboboxOpts;

  constructor(opts: ComboboxOpts) {
    this.id = opts.id;
    this.opts = opts;
    this.items = opts.items;
    this.width = Math.max(8, opts.width);
    this.rows = Math.max(1, opts.rows ?? 8);
    this.index = opts.index ?? -1;
    this.refilter();
  }

  get value(): string | null {
    return this.index >= 0 ? (this.items[this.index] ?? null) : null;
  }

  get filteredItems(): string[] {
    return this.matches.map((match) => match.label);
  }

  setItems(items: string[], index = -1): void {
    this.items = items;
    this.index = index >= 0 && index < items.length ? index : -1;
    this.open = false;
    this.setQuery('');
  }

  setQuery(query: string): void {
    this.query = query;
    this.editing = query.length > 0;
    this.caret = query.length;
    this.queryScroll = 0;
    this.highlight = 0;
    this.scroll = 0;
    this.refilter();
    this.opts.onQueryChange?.(query);
  }

  onFocus(): void {
    this.focused = true;
  }

  onBlur(): void {
    this.focused = false;
    this.open = false;
  }
  onPointerDownOutside(): boolean {
    if (!this.open) return false;
    this.open = false;
    return true;
  }

  private innerWidth(): number {
    return Math.max(1, this.width - 3);
  }

  private refilter(): void {
    const needle = this.query.trim().toLocaleLowerCase();
    this.matches = this.items
      .map((label, item) => ({ item, label }))
      .filter(({ label }) => !needle || label.toLocaleLowerCase().includes(needle));
    if (this.highlight >= this.matches.length) this.highlight = Math.max(0, this.matches.length - 1);

    const lines: VLine[] = [];
    this.matches.forEach((match, i) => {
      for (const text of wrapText(match.label, this.innerWidth())) lines.push({ match: i, text });
    });
    this.lines = lines;
  }

  private maxScroll(): number {
    return Math.max(0, this.lines.length - this.rows);
  }

  private openList(): void {
    this.open = true;
    const selected = this.matches.findIndex((match) => match.item === this.index);
    this.highlight = selected >= 0 ? selected : 0;
    this.scrollToHighlight();
  }

  private toggleList(): void {
    if (this.open) {
      this.open = false;
      this.setQuery('');
    } else this.openList();
  }

  private scrollToHighlight(): void {
    if (!this.lines.length) {
      this.scroll = 0;
      return;
    }
    let first = this.lines.findIndex((line) => line.match === this.highlight);
    if (first < 0) first = 0;
    let last = first;
    while (last + 1 < this.lines.length && this.lines[last + 1].match === this.highlight) last++;
    if (first < this.scroll) this.scroll = first;
    else if (last >= this.scroll + this.rows) this.scroll = last - this.rows + 1;
    this.scroll = Math.max(0, Math.min(this.maxScroll(), Math.min(this.scroll, first)));
  }

  private moveHighlight(delta: number): void {
    if (!this.matches.length) return;
    this.highlight = Math.max(0, Math.min(this.matches.length - 1, this.highlight + delta));
    this.scrollToHighlight();
  }

  private scrollBy(delta: number): void {
    this.scroll = Math.max(0, Math.min(this.maxScroll(), this.scroll + delta));
  }

  private replaceQuery(next: string, caret: number): void {
    this.query = next;
    this.editing = true;
    this.caret = Math.max(0, Math.min(next.length, caret));
    this.activated = true;
    this.highlight = 0;
    this.scroll = 0;
    this.refilter();
    this.opts.onQueryChange?.(next);
  }

  // The closed field can display a committed selection while the search query
  // is empty. Promote that label into the editable buffer on first text or
  // caret interaction so every visible character has a real cursor boundary.
  private beginEditingSelection(): void {
    if (this.editing) return;
    this.editing = true;
    if (!this.value) return;
    this.query = this.value;
    this.caret = this.query.length;
    this.queryScroll = 0;
    this.refilter();
    this.opts.onQueryChange?.(this.query);
  }

  private insert(raw: string): void {
    const printable = [...raw].filter((char) => char >= ' ' && char !== '\x7f').join('');
    if (!printable) return;
    this.replaceQuery(this.query.slice(0, this.caret) + printable + this.query.slice(this.caret), this.caret + printable.length);
    this.open = true;
  }

  pickMatch(matchIndex: number): void {
    const match = this.matches[matchIndex];
    if (!match) return;
    this.index = match.item;
    this.open = false;
    this.query = '';
    this.editing = false;
    this.caret = 0;
    this.refilter();
    this.opts.onSelect?.(match.item, match.label);
  }

  onKey(ev: KeyEvent): boolean {
    if (!ev.ctrl && !ev.meta && ev.raw && !['enter', 'tab', 'escape', 'backspace'].includes(ev.name)) {
      this.beginEditingSelection();
      this.insert(ev.raw);
      return true;
    }
    if (ev.name === 'backspace' || (ev.ctrl && (ev.name === 'u' || ev.name === 'w'))) {
      this.beginEditingSelection();
      const start = ev.super || (ev.ctrl && ev.name === 'u') ? 0 : ev.meta || ev.ctrl ? previousWord(this.query, this.caret) : Math.max(0, this.caret - 1);
      if (start < this.caret) this.replaceQuery(this.query.slice(0, start) + this.query.slice(this.caret), start);
      else this.activated = true;
      this.open = true;
      return true;
    }
    if (ev.name === 'delete' || (ev.ctrl && ev.name === 'k')) {
      this.beginEditingSelection();
      const end = ev.super || (ev.ctrl && ev.name === 'k') ? this.query.length : ev.meta || ev.ctrl ? nextWord(this.query, this.caret) : this.caret + 1;
      if (this.caret < this.query.length) this.replaceQuery(this.query.slice(0, this.caret) + this.query.slice(Math.min(this.query.length, end)), this.caret);
      else this.activated = true;
      return true;
    }
    if (ev.name === 'left' || ev.name === 'right') {
      this.activated = true;
      this.beginEditingSelection();
      if (ev.super) this.caret = ev.name === 'left' ? 0 : this.query.length;
      else if (ev.meta || ev.ctrl) this.caret = ev.name === 'left' ? previousWord(this.query, this.caret) : nextWord(this.query, this.caret);
      else this.caret = Math.max(0, Math.min(this.query.length, this.caret + (ev.name === 'left' ? -1 : 1)));
      return true;
    }
    if (ev.name === 'home' || ev.name === 'end' || (ev.ctrl && (ev.name === 'a' || ev.name === 'e'))) {
      this.activated = true;
      this.beginEditingSelection();
      this.caret = ev.name === 'home' || ev.name === 'a' ? 0 : this.query.length;
      return true;
    }
    if (ev.name === 'up' || ev.name === 'down') {
      if (!this.open) this.openList();
      else this.moveHighlight(ev.name === 'up' ? -1 : 1);
      return true;
    }
    if (ev.name === 'pageup' || ev.name === 'pagedown') {
      if (!this.open) this.openList();
      this.scrollBy(ev.name === 'pageup' ? -this.rows : this.rows);
      return true;
    }
    if (ev.name === 'enter') {
      if (!this.open) this.openList();
      else if (this.matches.length) this.pickMatch(this.highlight);
      return true;
    }
    if (ev.name === 'escape' && (this.open || this.query)) {
      this.open = false;
      this.setQuery('');
      return true;
    }
    return false;
  }

  private onInputMouse(ev: PointerHit): boolean {
    if (ev.type === 'down') {
      this.activated = true;
      this.beginEditingSelection();
      this.caret = Math.max(0, Math.min(this.query.length, this.queryScroll + ev.x - 1));
      this.openList();
    }
    return true;
  }

  private onToggleMouse(ev: PointerHit): boolean {
    if (ev.type === 'down') this.toggleList();
    return true;
  }

  private onOptionMouse(match: number, ev: PointerHit): boolean {
    if (ev.type === 'wheel') this.scrollBy(ev.wheel === -1 ? -WHEEL_STEP : WHEEL_STEP);
    else {
      this.highlight = match;
      if (ev.type === 'down') this.pickMatch(match);
    }
    return true;
  }

  private onListMouse(ev: PointerHit): boolean {
    if (ev.type === 'wheel') {
      this.scrollBy(ev.wheel === -1 ? -WHEEL_STEP : WHEEL_STEP);
      return true;
    }
    if (ev.x >= this.width - 1 && this.lines.length > this.rows) {
      const frac = ev.h > 1 ? ev.y / (ev.h - 1) : 0;
      this.scroll = Math.max(0, Math.min(this.maxScroll(), Math.round(frac * this.maxScroll())));
    }
    return true;
  }

  private paintBar(surf: Surface, box: LayoutBox): void {
    if (this.lines.length <= this.rows) return;
    const x = box.x + box.w - 1;
    const thumb = Math.max(1, Math.round((this.rows / this.lines.length) * box.h));
    const span = box.h - thumb;
    const top = box.y + (this.maxScroll() ? Math.round((this.scroll / this.maxScroll()) * span) : 0);
    for (let y = box.y; y < box.y + box.h; y++) {
      const color = y >= top && y < top + thumb ? THUMB : TRACK;
      surf.setCell(x, y, ' ', color, color);
    }
  }

  private reflowQuery(): void {
    const room = Math.max(1, this.width - 5);
    if (this.caret < this.queryScroll) this.queryScroll = this.caret;
    else if (this.caret >= this.queryScroll + room) this.queryScroll = this.caret - room + 1;
    this.queryScroll = Math.max(0, this.queryScroll);
  }

  private displayedValue(): string {
    return this.editing ? this.query : this.value || this.opts.placeholder || 'Search…';
  }

  private inputText(): string {
    const room = Math.max(1, this.width - 5);
    if (!this.editing) {
      const label = this.value ?? this.opts.placeholder ?? 'Search…';
      return label.length > room ? label.slice(0, Math.max(0, room - 1)) + '…' : label;
    }
    this.reflowQuery();
    return this.query.slice(this.queryScroll, this.queryScroll + room);
  }

  private paintCursor(surf: Surface, box: LayoutBox): void {
    if (!this.activated || box.w <= 0) return;
    this.reflowQuery();
    const logicalCaret = this.editing ? this.caret : 0;
    const scroll = this.editing ? this.queryScroll : 0;
    const x = box.x + logicalCaret - scroll;
    if (x < box.x || x >= box.x + box.w) return;
    const char = this.displayedValue()[logicalCaret] ?? ' ';
    if (this.focused) surf.setCell(x, box.y, char, CURSOR_FG, CURSOR);
    else {
      const bg = this.open ? defaultTheme.focusRing : defaultTheme.pillBg;
      surf.setCell(x, box.y, '▯', CURSOR, bg);
    }
  }

  build(): Node {
    const active = this.focused || this.open;
    const inputStyle: Style = {
      width: this.width - 3,
      padding: [0, 1],
      bold: true,
      color: this.query || this.index >= 0 ? (this.opts.accentColor ?? 'fg') : 'muted',
      background: active ? 'focusRing' : 'pillBg',
      hover: { background: 'focusRing' },
    };
    const input: Node = {
      ...Text({ text: this.inputText(), style: inputStyle }),
      id: this.id,
      focusable: true,
      onKey: (ev) => this.onKey(ev),
      onMouse: (ev) => this.onInputMouse(ev),
      draw: (surf, box) => this.paintCursor(surf, box),
    };
    const toggle: Node = {
      ...Text({
        text: this.open ? '▴' : '▾',
        id: this.id + '-toggle',
        style: {
          width: 3,
          padding: [0, 1],
          bold: true,
          color: 'muted',
          background: active ? 'focusRing' : 'pillBg',
          hover: { color: 'fg', background: 'focusRing' },
        },
      }),
      onMouse: (ev) => this.onToggleMouse(ev),
    };

    const children: Node[] = [Box({ flexDirection: 'row', width: this.width }, [input, toggle])];
    if (this.open) {
      if (!this.lines.length) {
        children.push({
          ...Box({ position: 'absolute', top: 1, left: 0, width: this.width, height: 1, background: 'pillBg' }, [
            Text({ text: this.opts.emptyLabel ?? 'No matches', style: { width: this.width, padding: [0, 1], color: 'muted', background: 'pillBg' } }),
          ]),
          overlay: true,
          onMouse: (ev: PointerHit) => this.onListMouse(ev),
        });
      } else {
        const visible = Math.min(this.lines.length, this.rows);
        const listRows = this.lines.slice(this.scroll, this.scroll + visible).map(({ match, text }) => {
          const activeRow = match === this.highlight;
          const row: Node = {
            ...Text({
              text,
              id: this.id + '-option-' + (this.matches[match]?.item ?? match),
              style: {
                width: this.width - 1,
                padding: [0, 1],
                color: activeRow ? 'pillHoverFg' : 'fg',
                background: activeRow ? 'pillHoverBg' : 'pillBg',
                hover: { color: 'pillHoverFg', background: 'pillHoverBg' },
              },
            }),
            onMouse: (ev: PointerHit) => this.onOptionMouse(match, ev),
          };
          return row;
        });
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
          draw: (surf, box) => this.paintBar(surf, box),
        });
      }
    }

    return Box({ flexDirection: 'column', alignItems: 'stretch', width: this.width }, children);
  }
}
