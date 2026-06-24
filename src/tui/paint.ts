// Walk a laid-out tree and draw it into a Surface. Each node's interaction state
// (hover/focus/pressed) is merged over its base style here, so the same tree
// renders differently depending on what's focused/hovered.
//
// Colors are resolved from tokens to RGBA via the theme. A background with
// alpha < 1 composites over whatever is already in the cell (the scene, once it
// fills the Surface) via setCellWithAlphaBlending; an opaque background fills
// flat. The resolved RGB is inherited by descendants so text without its own
// background still paints over the right color (black if nothing set it).

import {
  blendOver,
  STYLE_BOLD,
  STYLE_DIM,
  STYLE_UNDERLINE,
  type RGB,
  type RGBA,
  type Surface,
} from '../engine/index.ts';

import { defaultTheme, resolveColor, type Theme } from './theme.ts';
import type { LayoutBox, Node, Style } from './types.ts';

const DEFAULT_FG: RGB = [220, 220, 230];
const BLACK: RGB = [0, 0, 0];

export interface PaintState {
  hoverId: string | null;
  focusId: string | null;
  pressedId: string | null;
}

const rgbOf = (c: RGBA): RGB => [c[0], c[1], c[2]];

function styleBits(s: Style): number {
  let b = 0;
  if (s.bold) b |= STYLE_BOLD;
  if (s.dim) b |= STYLE_DIM;
  if (s.underline) b |= STYLE_UNDERLINE;
  return b;
}

// Base style with the active state overlays (hover, then focus, then pressed)
// shallow-merged on top. Later overlays win, so pressed beats hover.
function effective(node: Node, st: PaintState): Style {
  const s = node.style;
  let e: Style = { ...s };
  if (node.id) {
    if (node.id === st.hoverId && s.hover) e = { ...e, ...s.hover };
    if (node.id === st.focusId && s.focus) e = { ...e, ...s.focus };
    if (node.id === st.pressedId && s.pressed) e = { ...e, ...s.pressed };
  }
  return e;
}

function padOf(s: Style): { v: number; h: number } {
  const p = s.padding ?? 0;
  return Array.isArray(p) ? { v: p[0], h: p[1] } : { v: p, h: p };
}

const SQUARE = { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│' };
const ROUND = { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' };

function drawBorder(surf: Surface, lb: LayoutBox, e: Style, bg: RGB, bits: number, theme: Theme): void {
  if (lb.w < 2 || lb.h < 2) return;
  const c = e.border === 'round' ? ROUND : SQUARE;
  const col =
    e.borderColor != null
      ? rgbOf(resolveColor(e.borderColor, theme))
      : e.color != null
        ? rgbOf(resolveColor(e.color, theme))
        : DEFAULT_FG;
  const x2 = lb.x + lb.w - 1;
  const y2 = lb.y + lb.h - 1;
  surf.setCell(lb.x, lb.y, c.tl, col, bg, bits);
  surf.setCell(x2, lb.y, c.tr, col, bg, bits);
  surf.setCell(lb.x, y2, c.bl, col, bg, bits);
  surf.setCell(x2, y2, c.br, col, bg, bits);
  for (let x = lb.x + 1; x < x2; x++) {
    surf.setCell(x, lb.y, c.h, col, bg, bits);
    surf.setCell(x, y2, c.h, col, bg, bits);
  }
  for (let y = lb.y + 1; y < y2; y++) {
    surf.setCell(lb.x, y, c.v, col, bg, bits);
    surf.setCell(x2, y, c.v, col, bg, bits);
  }
}

function paintNode(node: Node, surf: Surface, st: PaintState, theme: Theme, inheritedBg: RGB | undefined): void {
  const lb = node.layout;
  if (lb && lb.w > 0 && lb.h > 0) {
    surf.setClip(node.clip ?? null); // overflow clipping from an ancestor
    const e = effective(node, st);
    const bits = styleBits(e);
    const b = e.border && e.border !== 'none' ? 1 : 0;
    let bg: RGB = inheritedBg ?? BLACK;
    if (e.background != null) {
      const c = resolveColor(e.background, theme);
      if (c[3] >= 1) {
        const rgb = rgbOf(c);
        surf.fillRect(lb.x, lb.y, lb.w, lb.h, rgb, bits);
        bg = rgb;
      } else if (c[3] > 0) {
        for (let yy = lb.y; yy < lb.y + lb.h; yy++) {
          for (let xx = lb.x; xx < lb.x + lb.w; xx++) surf.setCellWithAlphaBlending(xx, yy, ' ', c, c, bits);
        }
        bg = blendOver(inheritedBg ?? BLACK, c);
      }
      // c[3] === 0 (transparent): no fill; bg stays the inherited backdrop.
    }
    const fg = e.color != null ? rgbOf(resolveColor(e.color, theme)) : DEFAULT_FG;
    if (b) drawBorder(surf, lb, e, bg, bits, theme);
    if (node.kind !== 'box' && node.text) {
      const p = padOf(e);
      surf.drawText(lb.x + p.h + b, lb.y + p.v + b, node.text, fg, bg, bits);
    }
    inheritedBg = bg;
  }
  for (const c of node.children ?? []) paintNode(c, surf, st, theme, inheritedBg);
}

export function paint(root: Node, surf: Surface, st: PaintState, theme: Theme = defaultTheme): void {
  paintNode(root, surf, st, theme, undefined);
  surf.setClip(null); // don't leak a clip into later direct Surface writes
}
