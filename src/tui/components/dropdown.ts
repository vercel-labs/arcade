// One collapsing single-select component for ordinary and searchable lists.
// Search is opt-in, its filter never becomes the committed value, and its row
// stays sticky above the options. Overflow scrolls automatically after the
// configured number of visible rows.

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
  width: number;
  rows?: number; // max visible option rows before automatic scrolling, default 7
  searchable?: boolean; // sticky filter row, default false
  index?: number;
  placeholder?: string;
  searchPlaceholder?: string; // muted search prompt before activation
  emptyLabel?: string;
  accentColor?: ColorToken;
  // Bare field: no default pill background (transparent — shows the surface behind),
  // boxed only on hover/focus; the caret hugs the label (content-width, no ellipsis)
  // instead of padding to a fixed width. The option list still uses `width`.
  bare?: boolean;
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

export class Dropdown implements Component {
  id: string;
  items: string[];
  index: number;
  open = false;
  query = '';
  caret = 0;

  private focused = false;
  private editing = false;
  private queryScroll = 0;
  private highlight = 0;
  private scroll = 0;
  private matches: Match[] = [];
  private lines: VLine[] = [];
  private readonly width: number;
  private readonly rows: number;
  private opts: DropdownOpts;

  constructor(opts: DropdownOpts) {
    this.id = opts.id;
    this.opts = opts;
    this.items = opts.items;
    this.width = Math.max(8, opts.width);
    this.rows = Math.max(1, opts.rows ?? 7);
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

  setAccent(color: ColorToken): void {
    this.opts = { ...this.opts, accentColor: color };
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
    const resetSearch = this.open || !!this.query || this.editing;
    this.focused = false;
    this.open = false;
    if (this.searchable && resetSearch) this.setQuery('');
  }

  onPointerDownOutside(): boolean {
    if (!this.open && !this.query && !this.editing) return false;
    this.open = false;
    if (this.searchable) this.setQuery('');
    return true;
  }

  private get searchable(): boolean {
    return this.opts.searchable ?? false;
  }

  private refilter(): void {
    const needle = this.query.trim().toLocaleLowerCase();
    this.matches = this.items
      .map((label, item) => ({ item, label }))
      .filter(({ label }) => !needle || label.toLocaleLowerCase().includes(needle));
    if (this.highlight >= this.matches.length) this.highlight = Math.max(0, this.matches.length - 1);

    const wrapMatches = (width: number): VLine[] => {
      const lines: VLine[] = [];
      this.matches.forEach((match, i) => {
        for (const text of wrapText(match.label, width)) lines.push({ match: i, text });
      });
      return lines;
    };
    // Use the whole list width when it fits. Only narrow the option rows by one
    // column when overflow actually requires a scrollbar.
    this.lines = wrapMatches(Math.max(1, this.width - 2));
    if (this.lines.length > this.rows) this.lines = wrapMatches(Math.max(1, this.width - 3));
  }

  private maxScroll(): number {
    return Math.max(0, this.lines.length - this.rows);
  }

  private openList(): void {
    if (!this.open && (this.query || this.editing)) this.setQuery('');
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
    this.highlight = 0;
    this.scroll = 0;
    this.refilter();
    this.opts.onQueryChange?.(next);
  }

  private beginSearch(): void {
    if (this.editing) return;
    this.editing = true;
    this.caret = this.query.length;
    this.queryScroll = 0;
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
    if (this.searchable) this.setQuery('');
    this.opts.onSelect?.(match.item, match.label);
  }

  pick(itemIndex: number): void {
    if (itemIndex < 0 || itemIndex >= this.items.length) return;
    this.index = itemIndex;
    this.open = false;
    if (this.searchable) this.setQuery('');
    this.opts.onSelect?.(itemIndex, this.items[itemIndex]);
  }

  onKey(ev: KeyEvent): boolean {
    if (!this.searchable) {
      if (!this.open) {
        if (ev.name === 'enter' || ev.name === 'space' || ev.name === 'up' || ev.name === 'down') {
          this.openList();
          return true;
        }
        return false;
      }
      if (ev.name === 'up' || ev.name === 'k') this.moveHighlight(-1);
      else if (ev.name === 'down' || ev.name === 'j') this.moveHighlight(1);
      else if (ev.name === 'pageup') this.scrollBy(-this.rows);
      else if (ev.name === 'pagedown') this.scrollBy(this.rows);
      else if (ev.name === 'enter' || ev.name === 'space') this.pickMatch(this.highlight);
      else if (ev.name === 'escape') this.open = false;
      else return false;
      return true;
    }

    const printable = !ev.ctrl && !ev.meta && !!ev.raw && !['enter', 'tab', 'escape', 'backspace'].includes(ev.name);

    if (!this.open) {
      if (ev.name === 'enter' || ev.name === 'space' || ev.name === 'up' || ev.name === 'down') {
        this.openList();
        return true;
      }
      if (!printable) return false;
      this.openList();
      this.beginSearch();
      this.insert(ev.raw);
      return true;
    }

    if (printable) {
      this.beginSearch();
      this.insert(ev.raw);
      return true;
    }
    if (ev.name === 'backspace' || (ev.ctrl && (ev.name === 'u' || ev.name === 'w'))) {
      this.beginSearch();
      const start = ev.super || (ev.ctrl && ev.name === 'u') ? 0 : ev.meta || ev.ctrl ? previousWord(this.query, this.caret) : Math.max(0, this.caret - 1);
      if (start < this.caret) this.replaceQuery(this.query.slice(0, start) + this.query.slice(this.caret), start);
      return true;
    }
    if (ev.name === 'delete' || (ev.ctrl && ev.name === 'k')) {
      this.beginSearch();
      const end = ev.super || (ev.ctrl && ev.name === 'k') ? this.query.length : ev.meta || ev.ctrl ? nextWord(this.query, this.caret) : this.caret + 1;
      if (this.caret < this.query.length) this.replaceQuery(this.query.slice(0, this.caret) + this.query.slice(Math.min(this.query.length, end)), this.caret);
      return true;
    }
    if (ev.name === 'left' || ev.name === 'right') {
      if (!this.editing) return false;
      if (ev.super) this.caret = ev.name === 'left' ? 0 : this.query.length;
      else if (ev.meta || ev.ctrl) this.caret = ev.name === 'left' ? previousWord(this.query, this.caret) : nextWord(this.query, this.caret);
      else this.caret = Math.max(0, Math.min(this.query.length, this.caret + (ev.name === 'left' ? -1 : 1)));
      return true;
    }
    if (ev.name === 'home' || ev.name === 'end' || (ev.ctrl && (ev.name === 'a' || ev.name === 'e'))) {
      if (!this.editing) return false;
      this.caret = ev.name === 'home' || ev.name === 'a' ? 0 : this.query.length;
      return true;
    }
    if (ev.name === 'up' || ev.name === 'down') {
      this.moveHighlight(ev.name === 'up' ? -1 : 1);
      return true;
    }
    if (ev.name === 'pageup' || ev.name === 'pagedown') {
      this.scrollBy(ev.name === 'pageup' ? -this.rows : this.rows);
      return true;
    }
    if (ev.name === 'enter') {
      if (this.matches.length) this.pickMatch(this.highlight);
      return true;
    }
    if (ev.name === 'escape') {
      this.open = false;
      this.setQuery('');
      return true;
    }
    return false;
  }

  private onSearchMouse(ev: PointerHit): boolean {
    if (ev.type === 'down') {
      this.beginSearch();
      this.caret = Math.max(0, Math.min(this.query.length, this.queryScroll + ev.x - 1));
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
      return true;
    }
    const line = this.lines[this.scroll + ev.y];
    if (line) {
      this.highlight = line.match;
      if (ev.type === 'down') this.pickMatch(line.match);
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

  private searchRoom(): number {
    return Math.max(1, this.width - 2);
  }

  private reflowQuery(): void {
    const room = this.searchRoom();
    if (this.caret < this.queryScroll) this.queryScroll = this.caret;
    else if (this.caret >= this.queryScroll + room) this.queryScroll = this.caret - room + 1;
    this.queryScroll = Math.max(0, this.queryScroll);
  }

  private selectionText(): string {
    const caret = this.open ? '▴' : '▾';
    const label = this.value ?? this.opts.placeholder ?? 'Select…';
    // Bare: the caret hugs the label — no fixed-width padding, no ellipsis.
    if (this.opts.bare) return `${label} ${caret}`;
    const room = Math.max(1, this.width - 4);
    const shown = label.length > room ? label.slice(0, Math.max(0, room - 1)) + '…' : label;
    return shown.padEnd(room) + ' ' + caret;
  }

  private searchText(): string {
    if (!this.editing) return this.opts.searchPlaceholder ?? 'Search';
    this.reflowQuery();
    return this.query.slice(this.queryScroll, this.queryScroll + this.searchRoom());
  }

  private paintCursor(surf: Surface, box: LayoutBox): void {
    if (!this.editing || !this.focused || box.w <= 0) return;
    this.reflowQuery();
    const x = box.x + this.caret - this.queryScroll;
    if (x < box.x || x >= box.x + box.w) return;
    const char = this.query[this.caret] ?? ' ';
    surf.setCell(x, box.y, char, CURSOR_FG, CURSOR);
  }

  build(): Node {
    const active = this.focused || this.open;
    const bare = this.opts.bare ?? false;
    const fieldStyle: Style = bare
      ? {
          padding: [0, 0],
          bold: true,
          color: this.index >= 0 ? (this.opts.accentColor ?? 'fg') : 'muted',
          background: active ? 'focusRing' : undefined, // transparent until hover/focus
          hover: { background: 'focusRing' },
        }
      : {
          width: this.width,
          padding: [0, 1],
          bold: true,
          color: this.index >= 0 ? (this.opts.accentColor ?? 'fg') : 'muted',
          background: active ? 'focusRing' : 'pillBg',
          hover: { background: 'focusRing' },
        };
    const field: Node = {
      ...Text({ text: this.selectionText(), style: fieldStyle }),
      id: this.id,
      focusable: true,
      onKey: (ev) => this.onKey(ev),
      onMouse: (ev) => this.onToggleMouse(ev),
    };
    const children: Node[] = [field];
    if (this.open) {
      const dropdownTop = this.searchable ? 2 : 1;
      if (this.searchable) {
        const search: Node = {
          ...Text({
            text: this.searchText(),
            id: this.id + '-search',
            style: {
              position: 'absolute',
              top: 1,
              left: 0,
              width: this.width,
              padding: [0, 1],
              color: this.editing ? 'fg' : 'muted',
              background: 'pillBg',
              hover: { background: 'focusRing' },
              focus: { background: 'focusRing' },
            },
          }),
          focusable: true,
          overlay: true,
          onKey: (ev) => this.onKey(ev),
          onMouse: (ev) => this.onSearchMouse(ev),
          draw: (surf, box) => this.paintCursor(surf, box),
        };
        children.push(search);
      }

      if (!this.lines.length) {
        children.push({
          ...Box({ position: 'absolute', top: dropdownTop, left: 0, width: this.width, height: 1, background: 'pillBg' }, [
            Text({ text: this.opts.emptyLabel ?? 'No matches', style: { width: this.width, padding: [0, 1], color: 'muted', background: 'pillBg' } }),
          ]),
          overlay: true,
          onMouse: (ev: PointerHit) => this.onListMouse(ev),
        });
      } else {
        const visible = Math.min(this.lines.length, this.rows);
        const scrollable = this.lines.length > this.rows;
        const listRows = this.lines.slice(this.scroll, this.scroll + visible).map(({ match, text }) => {
          const activeRow = match === this.highlight;
          const row: Node = {
            ...Text({
              text,
              id: this.id + '-option-' + (this.matches[match]?.item ?? match),
              style: {
                width: this.width - (scrollable ? 1 : 0),
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
              top: dropdownTop,
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

    // Bare: shrink the column to the field's content width (so the caret hugs the
    // label); the option list is an absolute overlay and keeps its own `width`.
    return Box(
      bare
        ? { flexDirection: 'column', alignItems: 'start' }
        : { flexDirection: 'column', alignItems: 'stretch', width: this.width },
      children,
    );
  }
}
