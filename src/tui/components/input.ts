// A single-line text field. Persistent state (edit buffer + caret + horizontal
// scroll) lives on the instance, so it survives the per-frame tree rebuild — the
// reason it's a Component, not a plain builder. The visible text + caret are
// hand-drawn via a FrameBuffer draw hook so the caret can invert exactly one cell.

import { STYLE_REVERSE } from '../../engine/index.ts';
import type { Surface } from '../../engine/index.ts';
import type { KeyEvent } from '../../platform/input.ts';
import type { Component } from '../component.ts';
import type { Theme } from '../theme.ts';
import type { LayoutBox, Node } from '../types.ts';

export interface InputOpts {
  id: string;
  width?: number; // visible cell width, default 24
  value?: string;
  placeholder?: string;
  onChange?: (value: string) => void;
  onEnter?: (value: string) => void;
}

export class Input implements Component {
  id: string;
  value: string;
  caret: number;
  private width: number;
  private scroll = 0;
  private focused = false;
  private opts: InputOpts;

  constructor(opts: InputOpts) {
    this.id = opts.id;
    this.opts = opts;
    this.value = opts.value ?? '';
    this.caret = this.value.length;
    this.width = opts.width ?? 24;
  }

  onFocus(): void {
    this.focused = true;
  }
  onBlur(): void {
    this.focused = false;
  }

  onKey(ev: KeyEvent): boolean {
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

  private paint(surf: Surface, box: LayoutBox, theme: Theme): void {
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
      style: { width: this.width, height: 1, background: 'surfaceControl' },
      onKey: (ev) => this.onKey(ev),
      draw: (surf, b, theme) => this.paint(surf, b, theme),
    };
  }
}
