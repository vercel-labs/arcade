// A minimal flexbox solver. Not Yoga (wasm/native) — a hand-written subset that
// covers what the arcade UI needs: row/column flex, justify/align, gap, padding,
// border, grow, and fixed/percent/auto sizing. Because percent and grow resolve
// against a known parent size, it's a single bottom-up measure pass plus a single
// top-down position pass — no iterative constraint solver.
//
// `layout(root, box)` writes an absolute `LayoutBox` onto every node. Paint and
// hit-test both read those boxes, so geometry can't drift between them.

import { stringWidth } from '../engine/index.ts';

import type { LayoutBox, Node, Style } from './types.ts';

type Axis = 'w' | 'h';

function pad(s: Style): { v: number; h: number } {
  const p = s.padding ?? 0;
  return Array.isArray(p) ? { v: p[0], h: p[1] } : { v: p, h: p };
}

function border(s: Style): number {
  return s.border && s.border !== 'none' ? 1 : 0;
}

// Clamp a resolved size to the node's min/max for the given axis, floor at 0,
// and round to whole cells.
function clampDim(val: number, axis: Axis, s: Style): number {
  let v = val;
  if (axis === 'w') {
    if (s.minWidth != null) v = Math.max(v, s.minWidth);
    if (s.maxWidth != null) v = Math.min(v, s.maxWidth);
  } else {
    if (s.minHeight != null) v = Math.max(v, s.minHeight);
    if (s.maxHeight != null) v = Math.min(v, s.maxHeight);
  }
  return Math.max(0, Math.round(v));
}

// Natural size of a node along one axis, independent of its parent. Called only
// for 'auto'/undefined dimensions; percent children contribute 0 here (they
// resolve against the real parent size during positioning).
function intrinsic(node: Node, axis: Axis): number {
  const s = node.style;
  const explicit = axis === 'w' ? s.width : s.height;
  if (typeof explicit === 'number') return clampDim(explicit, axis, s);

  const p = pad(s);
  const b = border(s);
  const insetW = p.h * 2 + b * 2;
  const insetH = p.v * 2 + b * 2;

  if (node.kind !== 'box') {
    const base = axis === 'w' ? stringWidth(node.text ?? '') + insetW : 1 + insetH;
    return clampDim(base, axis, s);
  }

  const dir = s.flexDirection ?? 'row';
  const kids = node.children ?? [];
  const gap = s.gap ?? 0;
  const mainIsW = dir === 'row';
  let size: number;
  if ((axis === 'w') === mainIsW) {
    // Axis is the main axis: children sum along it (plus gaps).
    let sum = 0;
    for (const k of kids) sum += intrinsic(k, axis);
    sum += gap * Math.max(0, kids.length - 1);
    size = sum + (axis === 'w' ? insetW : insetH);
  } else {
    // Axis is the cross axis: children stack, so take the max.
    let max = 0;
    for (const k of kids) max = Math.max(max, intrinsic(k, axis));
    size = max + (axis === 'w' ? insetW : insetH);
  }
  return clampDim(size, axis, s);
}

function resolveMain(k: Node, axis: Axis, parent: number): number {
  const dim = axis === 'w' ? k.style.width : k.style.height;
  let v: number;
  if (typeof dim === 'number') v = dim;
  else if (dim && typeof dim === 'object') v = (parent * dim.pct) / 100;
  else v = intrinsic(k, axis);
  return clampDim(v, axis, k.style);
}

function resolveCross(k: Node, axis: Axis, parent: number, stretch: boolean): number {
  const dim = axis === 'w' ? k.style.width : k.style.height;
  let v: number;
  if (typeof dim === 'number') v = dim;
  else if (dim && typeof dim === 'object') v = (parent * dim.pct) / 100;
  else if (stretch) v = parent;
  else v = intrinsic(k, axis);
  return clampDim(v, axis, k.style);
}

// Lay out a node's children within its content box, then recurse.
function layoutContainer(node: Node): void {
  const box = node.layout!;
  const s = node.style;
  const p = pad(s);
  const b = border(s);
  const cx = box.x + p.h + b;
  const cy = box.y + p.v + b;
  const cw = Math.max(0, box.w - p.h * 2 - b * 2);
  const ch = Math.max(0, box.h - p.v * 2 - b * 2);

  const kids = node.children ?? [];
  if (kids.length === 0) return;

  const row = (s.flexDirection ?? 'row') === 'row';
  const mainAxis: Axis = row ? 'w' : 'h';
  const crossAxis: Axis = row ? 'h' : 'w';
  const mainSize = row ? cw : ch;
  const crossSize = row ? ch : cw;
  const gap = s.gap ?? 0;
  const totalGap = gap * (kids.length - 1);
  const justify = s.justifyContent ?? 'start';
  const align = s.alignItems ?? 'start';

  // 1. Base main-axis sizes, then distribute leftover space by flexGrow.
  const sizesMain = kids.map((k) => resolveMain(k, mainAxis, mainSize));
  const base = sizesMain.slice();
  const free = mainSize - (base.reduce((a, v) => a + v, 0) + totalGap);
  const grows = kids.map((k) => k.style.flexGrow ?? 0);
  const totalGrow = grows.reduce((a, v) => a + v, 0);
  if (free > 0 && totalGrow > 0) {
    let distributed = 0;
    let lastGrower = -1;
    for (let i = 0; i < kids.length; i++) {
      if (grows[i] <= 0) continue;
      const add = Math.floor((free * grows[i]) / totalGrow);
      sizesMain[i] += add;
      distributed += add;
      lastGrower = i;
    }
    if (lastGrower >= 0) sizesMain[lastGrower] += free - distributed; // exact total
  } else if (free < 0) {
    const totalBase = base.reduce((a, v) => a + v, 0) || 1;
    for (let i = 0; i < kids.length; i++) {
      sizesMain[i] = Math.max(0, sizesMain[i] - Math.round((-free * base[i]) / totalBase));
    }
  }

  // 2. Cross-axis sizes (stretch fills the cross axis).
  const sizesCross = kids.map((k) => resolveCross(k, crossAxis, crossSize, align === 'stretch'));

  // 3. Position along the main axis per justifyContent.
  const leftover = Math.max(0, mainSize - (sizesMain.reduce((a, v) => a + v, 0) + totalGap));
  let offset = 0;
  let spacing = gap;
  if (justify === 'center') offset = leftover / 2;
  else if (justify === 'end') offset = leftover;
  else if (justify === 'between') spacing = gap + (kids.length > 1 ? leftover / (kids.length - 1) : 0);
  else if (justify === 'around') {
    const sp = kids.length > 0 ? leftover / kids.length : 0;
    offset = sp / 2;
    spacing = gap + sp;
  }

  let mainPos = offset;
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i];
    const cross = sizesCross[i];
    let crossPos = 0;
    if (align === 'center') crossPos = (crossSize - cross) / 2;
    else if (align === 'end') crossPos = crossSize - cross;
    const mp = Math.round(mainPos);
    const cp = Math.round(crossPos);
    k.layout = row
      ? { x: cx + mp, y: cy + cp, w: sizesMain[i], h: cross }
      : { x: cx + cp, y: cy + mp, w: cross, h: sizesMain[i] };
    layoutContainer(k);
    mainPos += sizesMain[i] + spacing;
  }
}

// Lay out `root` to exactly `box`, then position its subtree. The caller decides
// where the root region sits (e.g. the reserved bottom bar row).
export function layout(root: Node, box: LayoutBox): void {
  root.layout = { ...box };
  layoutContainer(root);
}
