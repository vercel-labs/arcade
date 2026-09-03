// The TUI runtime. Holds the current root tree and the interaction state
// (hover/focus/pressed) keyed by node id — the "retained" part of the retained
// tree. The app rebuilds the tree each frame; the Screen carries state across
// frames and turns it into a paint + an escape string.
//
// Coordinate convention: the platform delivers 1-based mouse cells; everything
// inside the TUI (layout, Surface, hit-test) is 0-based, so the mouse methods
// subtract 1 at the boundary.

import { CellDiffer } from '../engine/diff.ts';
import { Surface } from '../engine/surface.ts';

import type { KeyEvent } from '../platform/input.ts';
import { type Component, Registry } from './component.ts';
import { focusOrder } from './focus.ts';
import { hitSurface, hitTest, hoverTest } from './hit.ts';
import { layout } from './layout.ts';
import { paint, paintWithForeground, type ForegroundPainter, type PaintState } from './paint.ts';
import { defaultTheme, type Theme } from './theme.ts';
import type { LayoutBox, Node, PointerHit, PulseStyle } from './types.ts';

export class Screen {
  cols: number;
  rows: number;
  private surface: Surface;
  private root: Node | null = null;
  private baseRoot: Node | null = null;
  private globalOverlay: Node | null = null;
  private state: PaintState = { hoverId: null, focusId: null, pressedId: null, time: 0, attention: new Map() };
  // Interaction state as of the last paint, for dirty() (mirrors the old
  // `hoveredButton !== lastHoveredButton` check that gated chess repaints).
  private painted: PaintState = { hoverId: null, focusId: null, pressedId: null };
  // Whether the current tree has any pulsing node (its own style.pulse, or an attention
  // pulse attached to its id). Only then does advancing the clock dirty the frame, so a
  // still screen keeps skipping repaints.
  private pulsing = false;
  // Set when an input mutates a component's INTERNAL state (a ScrollBox offset, an
  // Input caret, a Select index) — content the dirty() gate must repaint even
  // though hover/focus/pressed are unchanged. Without this, a wheel/arrow/drag on
  // the move panel updates state but the render-on-demand tick skips the write
  // until an unrelated click flips pressed/focus. Cleared after each painted frame.
  private contentDirty = false;
  // The region the root is laid out into. Stored so hit-testing always has fresh
  // geometry even on frames we don't repaint (e.g. an idle chess turntable).
  private region: LayoutBox = { x: 0, y: 0, w: 0, h: 0 };
  // Frame differ for the unified composited path (frameComposited).
  private differ = new CellDiffer();
  // Cached scene-only layer for the unified path: re-sampling the scene into
  // cells is the expensive step, so we recompute it only when the scene actually
  // changed and reuse it (cheap copy) on UI-only frames (e.g. a hover).
  private sceneLayer: Surface;
  private theme: Theme;
  private sceneValid = false;
  // Persistent components + the bookkeeping for their per-frame lifecycle: the
  // set of component ids referenced by last frame's tree, and which component
  // (if any) currently holds keyboard focus.
  private registry = new Registry();
  private mountedRefs = new Set<string>();
  private focusedComponent: string | null = null;
  // The node that received the last pointer 'down' and has onMouse — drags route
  // here (pointer capture) until the next up.
  private captured: Node | null = null;
  // Button held since the last down, replayed onto the drags that follow it.
  private pressButton = 0;
  // Every expanded node is associated with its persistent component owner. The
  // map includes floating overlay descendants, so their clicks still count as
  // inside the component even when they extend beyond the field's layout box.
  private nodeOwners = new WeakMap<Node, string>();
  // Focusable descendants may use their own ids (for example a dropdown's
  // internal search row) while still belonging to one component lifecycle.
  private focusOwners = new Map<string, string>();

  constructor(cols: number, rows: number, theme: Theme = defaultTheme) {
    this.cols = cols;
    this.rows = rows;
    this.theme = theme;
    this.surface = new Surface(cols, rows);
    this.sceneLayer = new Surface(cols, rows);
  }

  /** Replace the active palette without rebuilding component state. */
  setTheme(theme: Theme): void {
    if (theme === this.theme) return;
    this.theme = theme;
    this.sceneValid = false;
    this.differ.reset();
    this.contentDirty = true;
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
    this.baseRoot = root;
    if (region) this.region = region;
    this.composeRoot();
  }

  /** App-global chrome or modal painted and hit-tested above whichever root is active. */
  setGlobalOverlay(overlay: Node | null): void {
    this.globalOverlay = overlay;
    this.composeRoot();
    this.contentDirty = true;
  }

  // With a global overlay, the base root keeps its own region (a bottom bar strip, or a
  // screen narrowed by a rail) while the overlay spans the whole terminal above it.
  private composeRoot(): void {
    const full: LayoutBox = { x: 0, y: 0, w: this.cols, h: this.rows };
    const at = (node: Node, box: LayoutBox): Node => ({ ...node, style: { ...node.style, position: 'absolute', top: box.y, left: box.x, width: box.w, height: box.h } });
    this.root = this.globalOverlay
      ? { kind: 'box', style: { width: full.w, height: full.h, position: 'relative' }, children: [...(this.baseRoot ? [at(this.baseRoot, this.region)] : []), at(this.globalOverlay, full)] }
      : this.baseRoot;
    this.expand(this.root);
    if (this.root) layout(this.root, this.globalOverlay ? full : this.region);
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
    this.nodeOwners = new WeakMap<Node, string>();
    this.focusOwners = new Map<string, string>();
    const refs = new Set<string>();
    const attention = this.state.attention;
    let pulsing = false;
    const walk = (n: Node, owner: string | null): void => {
      if (n.style.pulse || (n.id && attention?.has(n.id))) pulsing = true;
      let nodeOwner = owner;
      if (n.component) {
        nodeOwner = n.component;
        const c = this.registry.get(n.component);
        if (c) {
          refs.add(n.component);
          n.children = [c.build()];
        }
      }
      if (nodeOwner) this.nodeOwners.set(n, nodeOwner);
      if (nodeOwner && n.id) this.focusOwners.set(n.id, nodeOwner);
      for (const ch of n.children ?? []) walk(ch, nodeOwner);
    };
    if (root) walk(root, null);

    // Focus transition (a component is "focused" only while its Slot is present).
    const fc = this.state.focusId ? (this.focusOwners.get(this.state.focusId) ?? (refs.has(this.state.focusId) ? this.state.focusId : null)) : null;
    if (fc !== this.focusedComponent) {
      if (this.focusedComponent) this.registry.get(this.focusedComponent)?.onBlur?.();
      if (fc) this.registry.get(fc)?.onFocus?.();
      this.focusedComponent = fc;
    }

    // Auto-unmount components that left the tree since last frame.
    for (const id of this.mountedRefs) if (!refs.has(id)) this.registry.unmount(id);
    this.mountedRefs = refs;
    this.pulsing = pulsing;
  }

  // Whether the current tree has a pulsing node — an on-demand screen uses this to keep
  // requesting frames while something breathes.
  animating(): boolean {
    return this.pulsing;
  }

  // Advance the clock attention pulses breathe against (seconds, monotonic). Dirties the
  // frame only while the current tree actually pulses, so still screens stay on-demand.
  setTime(t: number): void {
    if (t === this.state.time) return;
    this.state.time = t;
    if (this.pulsing) this.contentDirty = true;
  }

  // Attach an attention pulse to nodes by id — the app's way to draw the eye to a control
  // built elsewhere (a menu item, a bar pill) without the builder knowing. Replaces the
  // previous set; pass an empty list to clear. Takes effect at the next setRoot.
  setAttention(ids: Iterable<string>, pulse: PulseStyle): void {
    const map = new Map<string, PulseStyle>();
    for (const id of ids) map.set(id, pulse);
    this.state.attention = map;
    this.contentDirty = true;
  }

  // Paint the (already laid-out) root and return the escape string. No row clear
  // is emitted: the bar composites OVER the scene, so blanking a row would wipe
  // the scene showing through the transparent gaps between pills. Erasure of last
  // frame's opaque cells is handled by the scene's full-frame repaint (and by
  // fullRepaint/ESC[2J on geometry changes like resize). The pills are constant-
  // geometry per screen, so they leave no ghosts.
  frame(): string {
    this.surface.clear();
    if (this.root) paint(this.root, this.surface, this.state, this.theme);
    this.painted = { ...this.state };
    this.contentDirty = false;
    return this.surface.serialize();
  }

  // Unified compositing path. `present` fills a Surface with the scene (every
  // cell opaque); the UI paints over it (alpha-composited where translucent);
  // only cells changed since the last frame are emitted ('' when nothing
  // changed). `sceneChanged` lets a UI-only frame (e.g. a hover) skip the
  // expensive scene re-sample and reuse the cached scene layer — the perf
  // fix that makes this viable on static screens like the chess turntable.
  // resetDiff() (after an ESC[2J / resize) forces a full repaint next frame.
  frameComposited(present: (surf: Surface) => void, sceneChanged = true, foreground?: ForegroundPainter): string {
    if (sceneChanged || !this.sceneValid) {
      this.sceneLayer.clear();
      present(this.sceneLayer);
      this.sceneValid = true;
    }
    this.sceneLayer.copyInto(this.surface);
    if (this.root) {
      if (foreground) paintWithForeground(this.root, this.surface, this.state, foreground, this.theme);
      else paint(this.root, this.surface, this.state, this.theme);
    } else {
      foreground?.(this.surface);
    }
    this.painted = { ...this.state };
    this.contentDirty = false;
    return this.differ.diff(this.surface);
  }

  resetDiff(): void {
    this.differ.reset();
    this.sceneValid = false;
  }

  // Composite scene + UI into a fresh Surface and return it (no diff) — for
  // headless rasterization (snapshots / tests). The root must already be set.
  snapshot(present: (surf: Surface) => void, foreground?: ForegroundPainter): Surface {
    const surf = new Surface(this.cols, this.rows);
    present(surf);
    if (this.root) {
      if (foreground) paintWithForeground(this.root, surf, this.state, foreground, this.theme);
      else paint(this.root, surf, this.state, this.theme);
    } else {
      foreground?.(surf);
    }
    return surf;
  }

  // Whether interaction state changed since the last paint.
  dirty(): boolean {
    return (
      this.contentDirty ||
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

  // Set hover directly for headless previews and non-pointer integrations. The
  // normal terminal path should continue to use hover(x, y), which hit-tests the
  // laid-out tree before assigning the id.
  setHover(id: string | null): void {
    this.state.hoverId = id;
  }

  // Mouse move (1-based). Returns whether the hovered node changed.
  hover(x1: number, y1: number): boolean {
    const n = this.root ? hoverTest(this.root, x1 - 1, y1 - 1) : null;
    const id = n?.id ?? null;
    if (id === this.state.hoverId) return false;
    this.state.hoverId = id;
    return true;
  }

  // Mouse press (1-based). Focuses + fires the hit node's onClick (the old bar
  // also acted on `down`). If the node has onMouse it also gets a 'down' (with
  // local coords) and captures the pointer, so subsequent drag()s route to it.
  // `button` is the SGR button (0 = left, 2 = right); it reaches onMouse only —
  // onClick stays button-agnostic, so every existing pill fires on any button.
  // Returns the hit node, or null if the press missed.
  pointerDown(x1: number, y1: number, button = 0): Node | null {
    this.captured = null;
    this.pressButton = button;
    if (!this.root) return null;

    const x = x1 - 1;
    const y = y1 - 1;
    const surface = hitSurface(this.root, x, y);
    const target = hitTest(this.root, x, y);
    const owner = (target ? this.nodeOwners.get(target) : undefined) ?? (surface ? this.nodeOwners.get(surface) : undefined) ?? null;

    // Give rendered components a document-style outside-pointer hook. Ownership
    // covers their overlays, so option rows and scrollbars remain inside.
    for (const id of this.mountedRefs) {
      if (id === owner) continue;
      if (this.registry.get(id)?.onPointerDownOutside?.()) this.contentDirty = true;
    }

    // Pointer focus follows the web model: a focusable target gains focus; a
    // non-focusable click clears it unless it stayed inside the focused component.
    if (target?.focusable) this.state.focusId = target.id ?? null;
    else if (!owner || owner !== this.focusedComponent) this.state.focusId = null;

    // Absorb the press if it lands on ANY solid surface (panel or widget); only a
    // press over a transparent gap / open scene falls through to the caller.
    // Focus and outside-click handlers still run for those scene clicks.
    if (!surface) return null;

    // Route interaction (focus / onMouse / onClick) to the nearest interactive
    // node, which may be an ancestor of the surface (e.g. the Select that owns a
    // background-painted row).
    if (target) {
      this.state.pressedId = target.id ?? null;
      if (target.onMouse && target.layout) {
        this.captured = target;
        target.onMouse(this.local(target, x1, y1, 'down'));
        this.contentDirty = true; // e.g. clicking the scrollbar track jumps the offset
      }
      target.onClick?.();
    }
    return surface;
  }

  // Mouse drag (1-based). Routes to the node captured on the last down, if it
  // has onMouse. Returns true if consumed (caller skips scene gestures).
  drag(x1: number, y1: number): boolean {
    const n = this.captured;
    if (!n || !n.onMouse || !n.layout) return false;
    const handled = n.onMouse(this.local(n, x1, y1, 'drag'));
    if (handled) this.contentDirty = true;
    return handled;
  }

  // Mouse wheel (1-based). Routes to a component's onMouse (ScrollBox/Select/
  // Slider) when one is under the cursor. Returns true if the cursor is over ANY
  // solid UI surface — even a non-interactive panel — so the caller suppresses
  // the scene's wheel-zoom (the wheel doesn't propagate through the panel).
  wheel(x1: number, y1: number, dir: -1 | 1): boolean {
    if (!this.root) return false;
    const target = hitTest(this.root, x1 - 1, y1 - 1);
    if (target?.onMouse && target.layout) {
      target.onMouse({ ...this.local(target, x1, y1, 'wheel'), wheel: dir });
      this.contentDirty = true; // the scrollable likely moved — force a repaint
    }
    // Block the scene's wheel-zoom whenever the cursor is over any solid surface.
    return hitSurface(this.root, x1 - 1, y1 - 1) != null;
  }

  // Route a scroll key (↑/↓/PageUp/PageDown) to the interactive node under the
  // 1-based cell, so a hovered scrollable scrolls WITHOUT needing focus. Returns
  // true if that node's onKey consumed it. Limited to scroll keys so it never
  // steals typing/selection from a hovered (but unfocused) input/select.
  tryScrollKey(x1: number, y1: number, ev: KeyEvent): boolean {
    if (ev.name !== 'up' && ev.name !== 'down' && ev.name !== 'pageup' && ev.name !== 'pagedown') return false;
    if (!this.root) return false;
    const target = hitTest(this.root, x1 - 1, y1 - 1);
    const consumed = target?.onKey ? target.onKey(ev) : false;
    if (consumed) this.contentDirty = true;
    return consumed;
  }

  // Build a PointerHit in coordinates local to node n's layout box.
  private local(n: Node, x1: number, y1: number, type: 'down' | 'drag' | 'wheel'): PointerHit {
    const lb = n.layout!;
    return { type, x: x1 - 1 - lb.x, y: y1 - 1 - lb.y, w: lb.w, h: lb.h, button: this.pressButton };
  }

  // Mouse release: drop the pressed highlight + release the capture.
  pointerUp(): void {
    this.state.pressedId = null;
    this.captured = null;
  }

  // Keyboard. Consumes Tab / Shift+Tab (cycle focus forward/back) and Enter/Space
  // (activate the focused node), plus any focused node's custom onKey. Returns
  // true if consumed, so the caller can stop before its own per-screen handling.
  handleKey(ev: KeyEvent): boolean {
    if (!this.root) return false;
    const order = focusOrder(this.root);
    // Drop focus that pointed at a node in a PREVIOUS root — setRoot doesn't clear focusId, so a
    // button focused on another screen lingers. A stale id matches nothing here, but left set it
    // makes the enter/space branch below swallow the key (return true) instead of letting it fall
    // through to the keymap — which broke Enter-to-launch on the home cover flow.
    if (this.state.focusId && !order.some((n) => n.id === this.state.focusId)) this.state.focusId = null;
    if (this.state.focusId) {
      const f = order.find((n) => n.id === this.state.focusId);
      if (f?.onKey && f.onKey(ev)) {
        this.contentDirty = true; // focused widget mutated (caret, scroll, selection)
        return true;
      }
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
