// The TUI runtime. Holds the current root tree and the interaction state
// (hover/focus/pressed) keyed by node id — the "retained" part of the retained
// tree. The app rebuilds the tree each frame; the Screen carries state across
// frames and turns it into a paint + an escape string.
//
// Coordinate convention: the platform delivers 1-based mouse cells; everything
// inside the TUI (layout, Surface, hit-test) is 0-based, so the mouse methods
// subtract 1 at the boundary.

import { CellDiffer, Surface } from '../engine/index.ts';

import type { KeyEvent } from '../platform/input.ts';
import { type Component, Registry } from './component.ts';
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
  // Frame differ for the unified composited path (frameComposited).
  private differ = new CellDiffer();
  // Cached scene-only layer for the unified path: re-sampling the scene into
  // cells is the expensive step, so we recompute it only when the scene actually
  // changed and reuse it (cheap copy) on UI-only frames (e.g. a hover).
  private sceneLayer: Surface;
  private sceneValid = false;
  // Persistent components + the bookkeeping for their per-frame lifecycle: the
  // set of component ids referenced by last frame's tree, and which component
  // (if any) currently holds keyboard focus.
  private registry = new Registry();
  private mountedRefs = new Set<string>();
  private focusedComponent: string | null = null;

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.surface = new Surface(cols, rows);
    this.sceneLayer = new Surface(cols, rows);
  }

  resize(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    this.surface.resize(cols, rows);
    this.sceneLayer.resize(cols, rows);
    this.sceneValid = false;
    this.differ.reset();
  }

  // Set the tree and lay it out into `region` immediately, so hit-testing has
  // geometry even on ticks we don't repaint. The tree is rebuilt each frame;
  // setRoot does NOT mark dirty (so an idle chess screen with an unchanged bar
  // still skips repaints — dirty() tracks only interaction state).
  setRoot(root: Node | null, region?: LayoutBox): void {
    this.root = root;
    if (region) this.region = region;
    this.expand(this.root);
    if (this.root) layout(this.root, this.region);
  }

  // Register a persistent component instance (fires its onMount). Reference it in
  // the per-frame tree with Slot(id); expand() splices its build() output in.
  mount(c: Component): void {
    this.registry.mount(c);
  }

  // Drop a component (fires onUnmount). Usually unnecessary — expand() auto-
  // unmounts any component whose Slot left the tree.
  unmount(id: string): void {
    this.registry.unmount(id);
    this.mountedRefs.delete(id);
  }

  component(id: string): Component | undefined {
    return this.registry.get(id);
  }

  // Replace each Slot node's children with its live component's build() output,
  // then reconcile lifecycle as a set-diff: components whose Slot vanished since
  // last frame are unmounted, and onFocus/onBlur fire as keyboard focus moves
  // between components. Runs before layout so the spliced subtrees are measured.
  private expand(root: Node | null): void {
    const refs = new Set<string>();
    const walk = (n: Node): void => {
      if (n.component) {
        const c = this.registry.get(n.component);
        if (c) {
          refs.add(n.component);
          n.children = [c.build()];
        }
      }
      for (const ch of n.children ?? []) walk(ch);
    };
    if (root) walk(root);

    // Focus transition (a component is "focused" only while its Slot is present).
    const fc = this.state.focusId && refs.has(this.state.focusId) ? this.state.focusId : null;
    if (fc !== this.focusedComponent) {
      if (this.focusedComponent) this.registry.get(this.focusedComponent)?.onBlur?.();
      if (fc) this.registry.get(fc)?.onFocus?.();
      this.focusedComponent = fc;
    }

    // Auto-unmount components that left the tree since last frame.
    for (const id of this.mountedRefs) if (!refs.has(id)) this.registry.unmount(id);
    this.mountedRefs = refs;
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

  // Unified compositing path. `present` fills a Surface with the scene (every
  // cell opaque); the UI paints over it (alpha-composited where translucent);
  // only cells changed since the last frame are emitted ('' when nothing
  // changed). `sceneChanged` lets a UI-only frame (e.g. a hover) skip the
  // expensive scene re-sample and reuse the cached scene layer — the perf
  // fix that makes this viable on static screens like the chess turntable.
  // resetDiff() (after an ESC[2J / resize) forces a full repaint next frame.
  frameComposited(present: (surf: Surface) => void, sceneChanged = true): string {
    if (sceneChanged || !this.sceneValid) {
      this.sceneLayer.clear();
      present(this.sceneLayer);
      this.sceneValid = true;
    }
    this.sceneLayer.copyInto(this.surface);
    if (this.root) paint(this.root, this.surface, this.state);
    this.painted = { ...this.state };
    return this.differ.diff(this.surface);
  }

  resetDiff(): void {
    this.differ.reset();
    this.sceneValid = false;
  }

  // Composite scene + UI into a fresh Surface and return it (no diff) — for
  // headless rasterization (snapshots / tests). The root must already be set.
  snapshot(present: (surf: Surface) => void): Surface {
    const surf = new Surface(this.cols, this.rows);
    present(surf);
    if (this.root) paint(this.root, surf, this.state);
    return surf;
  }

  // Whether interaction state changed since the last paint.
  dirty(): boolean {
    return (
      this.state.hoverId !== this.painted.hoverId ||
      this.state.focusId !== this.painted.focusId ||
      this.state.pressedId !== this.painted.pressedId
    );
  }

  // Set keyboard focus directly (by node id), e.g. to focus a default option
  // when a modal opens. Matched against the tree's ids at paint/key time.
  setFocus(id: string | null): void {
    this.state.focusId = id;
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

  // Keyboard. Consumes Tab / Shift+Tab (cycle focus forward/back) and Enter/Space
  // (activate the focused node), plus any focused node's custom onKey. Returns
  // true if consumed, so the caller can stop before its own per-screen handling.
  handleKey(ev: KeyEvent): boolean {
    if (!this.root) return false;
    const order = focusOrder(this.root);
    if (this.state.focusId) {
      const f = order.find((n) => n.id === this.state.focusId);
      if (f?.onKey && f.onKey(ev)) return true;
    }
    if (ev.name === 'tab') {
      if (order.length === 0) return false;
      const idx = order.findIndex((n) => n.id === this.state.focusId);
      const step = ev.shift ? -1 : 1; // Shift+Tab walks focus backward
      const next = order[(idx + step + order.length) % order.length] ?? order[0];
      this.state.focusId = next.id ?? null;
      return true;
    }
    if (ev.name === 'enter' || ev.name === 'space') {
      if (!this.state.focusId) return false;
      const f = order.find((n) => n.id === this.state.focusId);
      f?.onClick?.();
      this.state.pressedId = f?.id ?? null;
      return true;
    }
    return false;
  }
}
