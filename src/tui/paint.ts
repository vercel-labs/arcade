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
  cellWidth,
  STYLE_BOLD,
  STYLE_DIM,
  STYLE_UNDERLINE,
  stringWidth,
  type RGB,
  type RGBA,
  type Surface,
} from '../engine/index.ts';

import { defaultTheme, resolveColor, type Theme } from './theme.ts';
import type { LayoutBox, Node, Padding, Style, TooltipSpec, TooltipText } from './types.ts';

export interface PaintState {
  hoverId: string | null;
  focusId: string | null;
  pressedId: string | null;
}

// A non-TUI layer painted between ordinary UI and portal overlays. This is the seam for
// foreground scene content (for example 3D dice that should cover projected labels while
// menus and dialogs still remain on top).
export type ForegroundPainter = (surf: Surface) => void;

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
        : theme.textPrimary;
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

function paintNode(node: Node, surf: Surface, st: PaintState, theme: Theme, inheritedBg: RGB | undefined, overlays: Node[] | null, deferSelf = true): void {
  // Defer overlay subtrees to a final pass so they float above later siblings.
  // While painting one overlay root, nested overlays are deferred again so they
  // float above every later child of that root (dropdown inside a modal/card).
  if (overlays && deferSelf && node.overlay) {
    overlays.push(node);
    return;
  }
  const lb = node.layout;
  if (lb && lb.w > 0 && lb.h > 0) {
    surf.setClip(node.clip ?? null); // overflow clipping from an ancestor
    const e = effective(node, st);
    // Scrim: dim the cells already in the Surface (the scene) under this node,
    // keeping their glyphs, before painting this node's own bg/content on top.
    if (e.scrim != null) surf.blendRect(lb.x, lb.y, lb.w, lb.h, resolveColor(e.scrim, theme));
    const bits = styleBits(e);
    const b = e.border && e.border !== 'none' ? 1 : 0;
    let bg: RGB = inheritedBg ?? theme.surfaceCanvas;
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
        bg = blendOver(inheritedBg ?? theme.surfaceCanvas, c);
      }
      // c[3] === 0 (transparent): no fill; bg stays the inherited backdrop.
    }
    const fg = e.color != null ? rgbOf(resolveColor(e.color, theme)) : theme.textPrimary;
    if (b) drawBorder(surf, lb, e, bg, bits, theme);
    if (node.kind !== 'box' && node.text) {
      const p = padOf(e);
      surf.drawText(lb.x + p.h + b, lb.y + p.v + b, node.text, fg, bg, bits);
    }
    // FrameBuffer escape hatch: hand-draw into this node's content box (inside the
    // border + padding), clipped like everything else. Runs after the node's own
    // bg/border so it draws on top of them.
    if (node.draw) {
      const p = padOf(e);
      const cx = lb.x + b + p.h;
      const cy = lb.y + b + p.v;
      node.draw(surf, { x: cx, y: cy, w: Math.max(0, lb.w - 2 * (b + p.h)), h: Math.max(0, lb.h - 2 * (b + p.v)) }, theme);
    }
    inheritedBg = bg;
  }
  for (const c of node.children ?? []) paintNode(c, surf, st, theme, inheritedBg, overlays, true);
}

interface TooltipLine {
  text: string;
  bold: boolean;
  color?: TooltipText['color'];
}

function tooltipPadding(padding: Padding | undefined): { top: number; right: number; bottom: number; left: number } {
  if (padding == null) return { top: 1, right: 2, bottom: 1, left: 2 };
  if (!Array.isArray(padding)) return { top: padding, right: padding, bottom: padding, left: padding };
  if (padding.length === 2) return { top: padding[0], right: padding[1], bottom: padding[0], left: padding[1] };
  return { top: padding[0], right: padding[1], bottom: padding[2], left: padding[3] };
}

// Split a single overlong word without splitting a terminal-wide glyph across
// rows. Tooltip copy is normally prose, but this keeps arbitrary app text inside
// its declared width rather than leaking over adjacent UI.
function splitWord(word: string, width: number): string[] {
  const out: string[] = [];
  let line = '';
  let used = 0;
  for (const ch of word) {
    const w = cellWidth(ch.codePointAt(0)!);
    if (line && used + w > width) {
      out.push(line);
      line = '';
      used = 0;
    }
    if (w > width) continue;
    line += ch;
    used += w;
  }
  if (line || out.length === 0) out.push(line);
  return out;
}

function wrapTooltipText(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean).flatMap((word) =>
      stringWidth(word) > width ? splitWord(word, width) : [word],
    );
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (line && stringWidth(next) > width) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    lines.push(line);
  }
  return lines;
}

function tooltipLines(spec: TooltipSpec, width: number): TooltipLine[] {
  const blocks = typeof spec.content === 'string' ? [spec.content] : spec.content;
  return blocks.flatMap((block) => {
    const rich = typeof block === 'string' ? { text: block } : block;
    return wrapTooltipText(rich.text, width).map((text) => ({
      text,
      bold: rich.bold ?? false,
      color: rich.color,
    }));
  });
}

function hoveredTooltip(root: Node, id: string | null): Node | null {
  if (!id) return null;
  let match: Node | null = null;
  const walk = (node: Node): void => {
    if (node.id === id && node.tooltip && node.layout) match = node;
    for (const child of node.children ?? []) walk(child);
  };
  walk(root);
  return match;
}

// Tooltips are painted after every portal overlay. Keeping them out of the Node
// tree avoids layout shifts and prevents invisible tooltip chrome from entering
// hit-testing; only the decorated trigger owns pointer interaction.
function paintTooltip(root: Node, surf: Surface, st: PaintState, theme: Theme): void {
  const trigger = hoveredTooltip(root, st.hoverId);
  const lb = trigger?.layout;
  const spec = trigger?.tooltip;
  if (!lb || !spec || surf.cols <= 0 || surf.rows <= 0) return;

  const padding = tooltipPadding(spec.padding);
  const requestedWidth = Math.max(1, spec.maxWidth ?? 36);
  const contentLimit = Math.max(1, Math.min(requestedWidth, surf.cols) - padding.left - padding.right);
  const lines = tooltipLines(spec, contentLimit);
  if (lines.length === 0) return;
  const contentWidth = Math.max(1, ...lines.map((line) => stringWidth(line.text)));
  const width = Math.min(surf.cols, contentWidth + padding.left + padding.right);
  const height = Math.min(surf.rows, lines.length + padding.top + padding.bottom);
  const arrow = spec.arrow ?? true;
  const arrowRows = arrow ? 1 : 0;
  const gap = Math.max(0, spec.gap ?? 0);
  const topRoom = lb.y;
  const bottomRoom = surf.rows - (lb.y + lb.h);
  const needed = height + arrowRows + gap;
  const requested = spec.placement ?? 'auto';
  const above = requested === 'top' || (requested === 'auto' && (topRoom >= needed || topRoom >= bottomRoom));
  let y = above
    ? lb.y - gap - arrowRows - height
    : lb.y + lb.h + gap + arrowRows;
  y = Math.max(0, Math.min(surf.rows - height, y));
  const center = lb.x + Math.floor(lb.w / 2);
  const x = Math.max(0, Math.min(surf.cols - width, center - Math.floor(width / 2)));

  surf.setClip(null);
  const bg = spec.background == null ? theme.tooltipBg : rgbOf(resolveColor(spec.background, theme));
  const fg = spec.color == null ? theme.tooltipFg : rgbOf(resolveColor(spec.color, theme));
  surf.fillRect(x, y, width, height, bg);
  const visibleLines = Math.max(0, height - padding.top - padding.bottom);
  for (let i = 0; i < Math.min(lines.length, visibleLines); i++) {
    const line = lines[i];
    const lineFg = line.color == null ? fg : rgbOf(resolveColor(line.color, theme));
    surf.drawText(x + padding.left, y + padding.top + i, line.text, lineFg, bg, line.bold ? STYLE_BOLD : 0);
  }

  if (arrow) {
    const arrowY = above ? y + height : y - 1;
    if (arrowY >= 0 && arrowY < surf.rows) {
      // The ordinary triangle glyphs have font-owned air above/below their ink, which leaves a
      // visible seam between the bubble and its tail. Paired diagonal blocks reach the cell edge:
      // `◥◤` is broad against a bubble above and tapers down; `◢◣` mirrors it for a bubble below.
      // Keep the one-cell fallback for the degenerate one-column tooltip.
      if (width >= 2) {
        const arrowX = Math.max(x, Math.min(x + width - 2, center - 1));
        const chars = above ? ['◥', '◤'] : ['◢', '◣'];
        for (let i = 0; i < chars.length; i++) {
          const under = surf.getCell(arrowX + i, arrowY)?.bg ?? theme.surfaceCanvas;
          surf.setCell(arrowX + i, arrowY, chars[i], bg, under);
        }
      } else {
        const under = surf.getCell(x, arrowY)?.bg ?? theme.surfaceCanvas;
        surf.setCell(x, arrowY, above ? '▼' : '▲', bg, under);
      }
    }
  }
}

function paintPhases(root: Node, surf: Surface, st: PaintState, theme: Theme, foreground?: ForegroundPainter): void {
  const overlays: Node[] = [];
  paintNode(root, surf, st, theme, undefined, overlays);
  // Ordinary descendants may leave an ancestor clip active. A foreground scene layer owns the
  // whole Surface, just like the base scene, so it must not inherit that implementation detail.
  surf.setClip(null);
  foreground?.(surf);
  // Each overlay layer is appended while its parent layer paints. That makes a
  // nested popover a later/topper layer than every ordinary child of its modal.
  for (let i = 0; i < overlays.length; i++) {
    const o = overlays[i];
    surf.setClip(o.clip ?? null);
    paintNode(o, surf, st, theme, undefined, overlays, false);
  }
  paintTooltip(root, surf, st, theme);
  surf.setClip(null); // don't leak a clip into later direct Surface writes
}

export function paint(root: Node, surf: Surface, st: PaintState, theme: Theme = defaultTheme): void {
  paintPhases(root, surf, st, theme);
}

/** Paint ordinary UI, then a foreground scene layer, then portal overlays. */
export function paintWithForeground(root: Node, surf: Surface, st: PaintState, foreground: ForegroundPainter, theme: Theme = defaultTheme): void {
  paintPhases(root, surf, st, theme, foreground);
}
