// A horizontal value control in [0,1]. Persistent value on the instance; ←/→
// (and h/l) nudge by `step`. The track + thumb are hand-drawn via the FrameBuffer
// hook: a filled bar up to the thumb, an empty track after it.

import { type RGB } from '../../engine/index.ts';
import type { Surface } from '../../engine/index.ts';
import type { KeyEvent } from '../../platform/input.ts';
import type { Component } from '../component.ts';
import { defaultTheme } from '../theme.ts';
import type { LayoutBox, Node } from '../types.ts';

export interface SliderOpts {
  id: string;
  width?: number; // track width in cells, default 20
  value?: number; // 0..1, default 0.5
  step?: number; // default 0.05
  onChange?: (value: number) => void;
}

const FILL: RGB = defaultTheme.accent;
const TRACK: RGB = defaultTheme.pillBg;
const THUMB_FOCUS: RGB = defaultTheme.fg;
const THUMB: RGB = defaultTheme.muted;

export class Slider implements Component {
  id: string;
  value: number;
  private width: number;
  private step: number;
  private focused = false;
  private opts: SliderOpts;

  constructor(opts: SliderOpts) {
    this.id = opts.id;
    this.opts = opts;
    this.value = Math.max(0, Math.min(1, opts.value ?? 0.5));
    this.width = opts.width ?? 20;
    this.step = opts.step ?? 0.05;
  }

  onFocus(): void {
    this.focused = true;
  }
  onBlur(): void {
    this.focused = false;
  }

  private nudge(delta: number): void {
    const v = Math.max(0, Math.min(1, this.value + delta));
    if (v !== this.value) {
      this.value = v;
      this.opts.onChange?.(v);
    }
  }

  onKey(ev: KeyEvent): boolean {
    if (ev.name === 'left' || ev.name === 'h') this.nudge(-this.step);
    else if (ev.name === 'right' || ev.name === 'l') this.nudge(this.step);
    else return false;
    return true;
  }

  private paint(surf: Surface, box: LayoutBox): void {
    const w = box.w;
    const thumbX = Math.round(this.value * (w - 1));
    for (let i = 0; i < w; i++) {
      const filled = i < thumbX;
      surf.setCell(box.x + i, box.y, filled ? '━' : '─', filled ? FILL : TRACK, defaultTheme.bg);
    }
    surf.setCell(box.x + thumbX, box.y, '●', this.focused ? THUMB_FOCUS : THUMB, defaultTheme.bg);
  }

  build(): Node {
    return {
      kind: 'box',
      id: this.id,
      focusable: true,
      style: { width: this.width, height: 1 },
      onKey: (ev) => this.onKey(ev),
      draw: (surf, b) => this.paint(surf, b),
    };
  }
}
