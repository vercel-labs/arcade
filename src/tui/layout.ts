// A minimal flexbox solver. Not Yoga (wasm/native) — a hand-written subset that
// covers what the arcade UI needs: row/column flex, justify/align, gap, margin,
// per-side padding, border, grow/shrink/basis, fixed/percent/auto sizing,
// absolute positioning, and overflow clipping. Because percent and grow resolve
// against a known parent size, it's a bottom-up measure pass plus a top-down
// position pass (with a small absolute pass) — no iterative constraint solver.
//
// `layout(root, box)` writes an absolute `LayoutBox` (and `clip`, when an
// ancestor sets overflow:hidden) onto every node. Paint and hit-test read those,
// so geometry can't drift between them.

import { stringWidth } from '../engine/index.ts';

import type { Dimension, LayoutBox, Node, Spacing, Style } from './types.ts';

type Axis = 'w' | 'h';
interface Sides {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

function sides(sp: Spacing | undefined): Sides {
  if (sp == null) return { top: 0, right: 0, bottom: 0, left: 0 };
  if (typeof sp === 'number') return { top: sp, right: sp, bottom: sp, left: sp };
  if (sp.length === 2) return { top: sp[0], right: sp[1], bottom: sp[0], left: sp[1] };
  return { top: sp[0], right: sp[1], bottom: sp[2], left: sp[3] };
}

const pad = (s: Style): Sides => sides(s.padding);
const margin = (s: Style): Sides => sides(s.margin);
const border = (s: Style): number => (s.border && s.border !== 'none' ? 1 : 0);
const isAbsolute = (n: Node): boolean => (n.style.position ?? 'relative') === 'absolute';

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

// A position/size offset value resolved against a parent length (px or %).
function off(d: Dimension | undefined, parent: number): number {
  if (typeof d === 'number') return d;
  if (d && typeof d === 'object') return (parent * d.pct) / 100;
  return 0;
}

// Natural size of a node along one axis, independent of its parent. Called only
// for 'auto'/undefined dimensions; percent children contribute 0 here. Absolute
// children are out of flow, so they don't add to a parent's intrinsic size.
function intrinsic(node: Node, axis: Axis): number {
  const s = node.style;
  const explicit = axis === 'w' ? s.width : s.height;
  if (typeof explicit === 'number') return clampDim(explicit, axis, s);

  const p = pad(s);
  const b = border(s);
  const insetW = p.left + p.right + b * 2;
  const insetH = p.top + p.bottom + b * 2;

  if (node.kind !== 'box') {
    const base = axis === 'w' ? stringWidth(node.text ?? '') + insetW : 1 + insetH;
    return clampDim(base, axis, s);
  }

  const dir = s.flexDirection ?? 'row';
  const gap = s.gap ?? 0;
  const mainIsW = dir === 'row';
  let size: number;
  if ((axis === 'w') === mainIsW) {
    // Axis is the main axis: in-flow children sum along it (plus margins, gaps).
    let sum = 0;
    let cnt = 0;
    for (const k of node.children ?? []) {
      if (isAbsolute(k)) continue;
      const m = margin(k.style);
      sum += intrinsic(k, axis) + (mainIsW ? m.left + m.right : m.top + m.bottom);
      cnt++;
    }
    sum += gap * Math.max(0, cnt - 1);
    size = sum + (axis === 'w' ? insetW : insetH);
  } else {
    // Axis is the cross axis: in-flow children stack, so take the max.
    let max = 0;
    for (const k of node.children ?? []) {
      if (isAbsolute(k)) continue;
      const m = margin(k.style);
      max = Math.max(max, intrinsic(k, axis) + (mainIsW ? m.top + m.bottom : m.left + m.right));
    }
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

// Base main-axis size before grow/shrink — flexBasis overrides width/height.
function resolveBasis(k: Node, axis: Axis, parent: number): number {
  if (k.style.flexBasis != null) return clampDim(k.style.flexBasis, axis, k.style);
  return resolveMain(k, axis, parent);
}

function resolveCross(k: Node, axis: Axis, avail: number, stretch: boolean): number {
  const dim = axis === 'w' ? k.style.width : k.style.height;
  let v: number;
  if (typeof dim === 'number') v = dim;
  else if (dim && typeof dim === 'object') v = (avail * dim.pct) / 100;
  else if (stretch) v = avail;
  else v = intrinsic(k, axis);
  return clampDim(v, axis, k.style);
}

// Absolute child's size along an axis: explicit, derived from left+right (or
// top+bottom), or intrinsic.
function resolveAbsSize(k: Node, axis: Axis, parent: number): number {
  const dim = axis === 'w' ? k.style.width : k.style.height;
  const lead = axis === 'w' ? k.style.left : k.style.top;
  const trail = axis === 'w' ? k.style.right : k.style.bottom;
  if (dim == null && lead != null && trail != null) {
    return clampDim(parent - off(lead, parent) - off(trail, parent), axis, k.style);
  }
  if (typeof dim === 'number') return clampDim(dim, axis, k.style);
  if (dim && typeof dim === 'object') return clampDim((parent * dim.pct) / 100, axis, k.style);
  return intrinsic(k, axis);
}

function resolveAbsPos(k: Node, axis: Axis, parent: number, size: number): number {
  const lead = axis === 'w' ? k.style.left : k.style.top;
  const trail = axis === 'w' ? k.style.right : k.style.bottom;
  if (lead != null) return Math.round(off(lead, parent));
  if (trail != null) return Math.round(parent - off(trail, parent) - size);
  return 0;
}

function intersect(a: LayoutBox | undefined, b: LayoutBox): LayoutBox {
  if (!a) return b;
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  return { x, y, w: Math.max(0, x2 - x), h: Math.max(0, y2 - y) };
}

// Lay out a node's children within its content box, then recurse. `clip` is the
// rect this node is clipped to (from an ancestor's overflow:hidden), or undefined.
function layoutContainer(node: Node, clip: LayoutBox | undefined): void {
  node.clip = clip;
  const box = node.layout!;
  const s = node.style;
  const p = pad(s);
  const b = border(s);
  const cx = box.x + p.left + b;
  const cy = box.y + p.top + b;
  const cw = Math.max(0, box.w - p.left - p.right - b * 2);
  const ch = Math.max(0, box.h - p.top - p.bottom - b * 2);
  const childClip = s.overflow === 'hidden' ? intersect(clip, { x: cx, y: cy, w: cw, h: ch }) : clip;

  const all = node.children ?? [];
  const flow = all.filter((k) => !isAbsolute(k));

  if (flow.length > 0) {
    const row = (s.flexDirection ?? 'row') === 'row';
    const mainAxis: Axis = row ? 'w' : 'h';
    const crossAxis: Axis = row ? 'h' : 'w';
    const mainSize = row ? cw : ch;
    const crossSize = row ? ch : cw;
    const gap = s.gap ?? 0;
    const totalGap = gap * (flow.length - 1);
    const justify = s.justifyContent ?? 'start';
    const align = s.alignItems ?? 'start';

    const mar = flow.map((k) => margin(k.style));
    const marMain = (m: Sides): number => (row ? m.left + m.right : m.top + m.bottom);
    const sumMargin = mar.reduce((a, m) => a + marMain(m), 0);

    // 1. Base main sizes (flexBasis overrides), then distribute grow / shrink.
    const base = flow.map((k) => resolveBasis(k, mainAxis, mainSize));
    const sizesMain = base.slice();
    const free = mainSize - (base.reduce((a, v) => a + v, 0) + sumMargin + totalGap);
    const grows = flow.map((k) => k.style.flexGrow ?? 0);
    const totalGrow = grows.reduce((a, v) => a + v, 0);
    if (free > 0 && totalGrow > 0) {
      let distributed = 0;
      let last = -1;
      for (let i = 0; i < flow.length; i++) {
        if (grows[i] <= 0) continue;
        const add = Math.floor((free * grows[i]) / totalGrow);
        sizesMain[i] += add;
        distributed += add;
        last = i;
      }
      if (last >= 0) sizesMain[last] += free - distributed;
    } else if (free < 0) {
      const weighted = base.map((bv, i) => bv * (flow[i].style.flexShrink ?? 1));
      const totalW = weighted.reduce((a, v) => a + v, 0) || 1;
      for (let i = 0; i < flow.length; i++) {
        sizesMain[i] = Math.max(0, sizesMain[i] - Math.round((-free * weighted[i]) / totalW));
      }
    }

    // 2/3. Position along the main axis per justifyContent; place cross axis.
    const usedMain = sizesMain.reduce((a, v) => a + v, 0) + sumMargin + totalGap;
    const leftover = Math.max(0, mainSize - usedMain);
    let offset = 0;
    let spacing = gap;
    if (justify === 'center') offset = leftover / 2;
    else if (justify === 'end') offset = leftover;
    else if (justify === 'between') spacing = gap + (flow.length > 1 ? leftover / (flow.length - 1) : 0);
    else if (justify === 'around') {
      const sp = flow.length > 0 ? leftover / flow.length : 0;
      offset = sp / 2;
      spacing = gap + sp;
    } else if (justify === 'evenly') {
      const sp = leftover / (flow.length + 1);
      offset = sp;
      spacing = gap + sp;
    }

    let mainPos = offset;
    for (let i = 0; i < flow.length; i++) {
      const k = flow[i];
      const m = mar[i];
      const mLead = row ? m.left : m.top;
      const mTrail = row ? m.right : m.bottom;
      const crossLead = row ? m.top : m.left;
      const crossAvail = Math.max(0, crossSize - (row ? m.top + m.bottom : m.left + m.right));
      const cross = resolveCross(k, crossAxis, crossAvail, align === 'stretch');
      let crossPos = crossLead;
      if (align === 'center') crossPos = crossLead + (crossAvail - cross) / 2;
      else if (align === 'end') crossPos = crossLead + (crossAvail - cross);
      mainPos += mLead;
      const mp = Math.round(mainPos);
      const cp = Math.round(crossPos);
      k.layout = row
        ? { x: cx + mp, y: cy + cp, w: sizesMain[i], h: cross }
        : { x: cx + cp, y: cy + mp, w: cross, h: sizesMain[i] };
      layoutContainer(k, childClip);
      mainPos += sizesMain[i] + mTrail + spacing;
    }
  }

  // Absolute children: positioned against this node's content box (cx,cy,cw,ch).
  for (const k of all) {
    if (!isAbsolute(k)) continue;
    const w = resolveAbsSize(k, 'w', cw);
    const h = resolveAbsSize(k, 'h', ch);
    k.layout = { x: cx + resolveAbsPos(k, 'w', cw, w), y: cy + resolveAbsPos(k, 'h', ch, h), w, h };
    layoutContainer(k, childClip);
  }
}

// Lay out `root` to exactly `box`, then position its subtree. The caller decides
// where the root region sits (e.g. the bottom bar band).
export function layout(root: Node, box: LayoutBox): void {
  root.layout = { ...box };
  layoutContainer(root, undefined);
}
