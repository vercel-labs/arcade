// The TUI runtime. Holds the current root tree and the interaction state
// (hover/focus/pressed) keyed by node id — the "retained" part of the retained
// tree. The app rebuilds the tree each frame; the Screen carries state across
// frames and turns it into a paint + an escape string.
//
// Coordinate convention: the platform delivers 1-based mouse cells; everything
// inside the TUI (layout, Surface, hit-test) is 0-based, so the mouse methods
// subtract 1 at the boundary.

import { Surface } from '../engine/index.ts';

import type { Key } from '../platform/input.ts';
import { focusOrder } from './focus.ts';
import { hitTest } from './hit.ts';
import { layout } from './layout.ts';
import { paint, type PaintState } from './paint.ts';
import type { LayoutBox, Node } from './types.ts';

export class Screen {
  cols: number;
  rows: number;
  private surface: Surface;
  private root: Node | null = null;
  private state: PaintState = { hoverId: null, focusId: null, pressedId: null };
  // Interaction state as of the last paint, for dirty() (mirrors the old
  // `hoveredButton !== lastHoveredButton` check that gated chess repaints).
  private painted: PaintState = { hoverId: null, focusId: null, pressedId: null };
  // The region the root is laid out into. Stored so hit-testing always has fresh
  // geometry even on frames we don't repaint (e.g. an idle chess turntable).
  private region: LayoutBox = { x: 0, y: 0, w: 0, h: 0 };

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.surface = new Surface(cols, rows);
  }

  resize(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    this.surface.resize(cols, rows);
  }

  // Set the tree and lay it out into `region` immediately, so hit-testing has
  // geometry even on ticks we don't repaint. The tree is rebuilt each frame;
  // setRoot does NOT mark dirty (so an idle chess screen with an unchanged bar
  // still skips repaints — dirty() tracks only interaction state).
  setRoot(root: Node | null, region?: LayoutBox): void {
    this.root = root;
    if (region) this.region = region;
    if (this.root) layout(this.root, this.region);
  }

  // Paint the (already laid-out) root and return the escape string. No row clear
  // is emitted: the bar composites OVER the scene, so blanking a row would wipe
  // the scene showing through the transparent gaps between pills. Erasure of last
  // frame's opaque cells is handled by the scene's full-frame repaint (and by
  // fullRepaint/ESC[2J on geometry changes like resize). The pills are constant-
  // geometry per screen, so they leave no ghosts.
  frame(): string {
    this.surface.clear();
    if (this.root) paint(this.root, this.surface, this.state);
    this.painted = { ...this.state };
    return this.surface.serialize();
  }

  // Whether interaction state changed since the last paint.
  dirty(): boolean {
    return (
      this.state.hoverId !== this.painted.hoverId ||
      this.state.focusId !== this.painted.focusId ||
      this.state.pressedId !== this.painted.pressedId
    );
  }

  // Mouse move (1-based). Returns whether the hovered node changed.
  hover(x1: number, y1: number): boolean {
    const n = this.root ? hitTest(this.root, x1 - 1, y1 - 1) : null;
    const id = n?.id ?? null;
    if (id === this.state.hoverId) return false;
    this.state.hoverId = id;
    return true;
  }

  // Mouse press (1-based). Focuses + fires the hit node's onClick (the old bar
  // also acted on `down`). Returns the hit node, or null if the press missed.
  pointerDown(x1: number, y1: number): Node | null {
    const n = this.root ? hitTest(this.root, x1 - 1, y1 - 1) : null;
    if (!n) return null;
    this.state.pressedId = n.id ?? null;
    if (n.focusable) this.state.focusId = n.id ?? null;
    n.onClick?.();
    return n;
  }

  // Mouse release: drop the pressed highlight.
  pointerUp(): void {
    this.state.pressedId = null;
  }

  // Keyboard. Consumes Tab (cycle focus) and Enter/Space (activate the focused
  // node), plus any focused node's custom onKey. Returns true if consumed, so
  // the caller can stop before its own per-screen key handling.
  handleKey(key: Key): boolean {
    if (!this.root) return false;
    const order = focusOrder(this.root);
    if (this.state.focusId) {
      const f = order.find((n) => n.id === this.state.focusId);
      if (f?.onKey && f.onKey(key)) return true;
    }
    if (key === '\t') {
      if (order.length === 0) return false;
      const idx = order.findIndex((n) => n.id === this.state.focusId);
      const next = order[(idx + 1 + order.length) % order.length] ?? order[0];
      this.state.focusId = next.id ?? null;
      return true;
    }
    if (key === '\r' || key === '\n' || key === ' ') {
      if (!this.state.focusId) return false;
      const f = order.find((n) => n.id === this.state.focusId);
      f?.onClick?.();
      this.state.pressedId = f?.id ?? null;
      return true;
    }
    return false;
  }
}
