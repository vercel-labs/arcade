// A text field. Persistent state (edit buffer + caret + scroll) lives on the
// instance, so it survives the per-frame tree rebuild — the reason it's a
// Component, not a plain builder. The visible text + caret are hand-drawn via a
// FrameBuffer draw hook so the caret can invert exactly one cell.

import { STYLE_REVERSE, type Surface } from '../../engine/surface.ts';
import { stringWidth } from '../../engine/width.ts';
import type { KeyEvent } from '../../platform/input.ts';
import type { Component } from '../component.ts';
import type { Theme } from '../theme.ts';
import type { LayoutBox, Node } from '../types.ts';

export interface InputOpts {
  id: string;
  width?: number; // visible cell width, default 24
  /** Grow by visually wrapping until this many rows, then vertically scroll. Default 1. */
  maxRows?: number;
  value?: string;
  placeholder?: string;
  onChange?: (value: string) => void;
  onEnter?: (value: string) => void;
  /** Optional component-specific key handling before the default editor behavior. */
  onKeyDown?: (event: KeyEvent, input: Input) => boolean;
}

export class Input implements Component {
  id: string;
  value: string;
  caret: number;
  private width: number;
  private maxRows: number;
  private scroll = 0;
  private rowScroll = 0;
  private focused = false;
  private opts: InputOpts;

  constructor(opts: InputOpts) {
    this.id = opts.id;
    this.opts = opts;
    this.value = opts.value ?? '';
    this.caret = this.value.length;
    this.width = opts.width ?? 24;
    this.maxRows = Math.max(1, Math.floor(opts.maxRows ?? 1));
  }

  onFocus(): void {
    this.focused = true;
  }
  onBlur(): void {
    this.focused = false;
  }

  onKey(ev: KeyEvent): boolean {
    if (this.opts.onKeyDown?.(ev, this)) return true;
    const before = this.value;
    if (ev.name === 'left') this.caret = Math.max(0, this.caret - 1);
    else if (ev.name === 'right') this.caret = Math.min(this.value.length, this.caret + 1);
    else if (ev.name === 'backspace') {
      if (this.caret > 0) {
        this.value = this.value.slice(0, this.caret - 1) + this.value.slice(this.caret);
        this.caret--;
      }
    } else if (ev.name === 'enter') {
      this.opts.onEnter?.(this.value);
    } else if (ev.raw.length === 1 && ev.raw >= ' ' && !ev.ctrl) {
      // A printable character (raw preserves case/punctuation).
      this.value = this.value.slice(0, this.caret) + ev.raw + this.value.slice(this.caret);
      this.caret++;
    } else {
      return false; // let Tab/etc. fall through to the Screen
    }
    if (this.value !== before) this.opts.onChange?.(this.value);
    return true;
  }

  // Keep the caret inside the visible window [scroll, scroll+width).
  private reflow(): void {
    if (this.caret < this.scroll) this.scroll = this.caret;
    else if (this.caret >= this.scroll + this.width) this.scroll = this.caret - this.width + 1;
  }

  private flow(text: string): { rows: string[]; caretRow: number; caretCol: number } {
    const rows = [''];
    let row = 0;
    let col = 0;
    let caretRow = 0;
    let caretCol = 0;
    let index = 0;
    if (this.caret === 0) {
      caretRow = row;
      caretCol = col;
    }
    while (index < text.length) {
      const ch = String.fromCodePoint(text.codePointAt(index)!);
      const width = Math.max(1, stringWidth(ch));
      if (col > 0 && col + width > this.width) {
        rows.push('');
        row++;
        col = 0;
      }
      if (index === this.caret) {
        caretRow = row;
        caretCol = col;
      }
      rows[row] += ch;
      col += width;
      index += ch.length;
      if (index === this.caret) {
        caretRow = row;
        caretCol = col;
      }
    }
    return { rows, caretRow, caretCol };
  }

  visibleRows(): number {
    if (this.maxRows === 1) return 1;
    return Math.min(this.maxRows, this.flow(this.value).rows.length);
  }

  private paintMultiline(surf: Surface, box: LayoutBox, theme: Theme): void {
    const showPlaceholder = this.value.length === 0 && this.opts.placeholder != null;
    const valueFlow = this.flow(this.value);
    if (valueFlow.caretRow < this.rowScroll) this.rowScroll = valueFlow.caretRow;
    else if (valueFlow.caretRow >= this.rowScroll + box.h) this.rowScroll = valueFlow.caretRow - box.h + 1;
    const source = showPlaceholder ? this.flow(this.opts.placeholder!) : valueFlow;
    const fg = showPlaceholder ? theme.textMuted : theme.textPrimary;
    for (let row = 0; row < box.h; row++) {
      surf.drawText(box.x, box.y + row, ' '.repeat(box.w), fg, theme.surfaceControl);
      surf.drawText(box.x, box.y + row, source.rows[this.rowScroll + row] ?? '', fg, theme.surfaceControl);
    }
    if (this.focused) {
      const y = box.y + valueFlow.caretRow - this.rowScroll;
      const x = box.x + valueFlow.caretCol;
      const ch = String.fromCodePoint(this.value.codePointAt(this.caret) ?? 32);
      if (x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h) {
        surf.setCell(x, y, ch, theme.textPrimary, theme.surfaceControl, STYLE_REVERSE);
      }
    }
  }

  private paint(surf: Surface, box: LayoutBox, theme: Theme): void {
    if (this.maxRows > 1) {
      this.paintMultiline(surf, box, theme);
      return;
    }
    this.reflow();
    const showPlaceholder = this.value.length === 0 && this.opts.placeholder != null;
    const text = showPlaceholder ? this.opts.placeholder! : this.value;
    const fg = showPlaceholder ? theme.textMuted : theme.textPrimary;
    const visible = text.slice(this.scroll, this.scroll + box.w);
    surf.drawText(box.x, box.y, visible.padEnd(box.w), fg, theme.surfaceControl);
    if (this.focused) {
      const cx = box.x + (this.caret - this.scroll);
      const ch = (showPlaceholder ? text[this.caret] : this.value[this.caret]) ?? ' ';
      if (cx >= box.x && cx < box.x + box.w) surf.setCell(cx, box.y, ch, theme.textPrimary, theme.surfaceControl, STYLE_REVERSE);
    }
  }

  build(): Node {
    return {
      kind: 'box',
      id: this.id,
      focusable: true,
      style: { width: this.width, height: this.visibleRows(), background: 'surfaceControl' },
      onKey: (ev) => this.onKey(ev),
      draw: (surf, b, theme) => this.paint(surf, b, theme),
    };
  }
}
