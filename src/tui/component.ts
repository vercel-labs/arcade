// The narrow persistent-instance substrate — NOT a reconciler. The UI tree is
// still plain data rebuilt every frame; this exists only for the handful of
// components whose internal state must survive those rebuilds (an Input's caret
// and edit buffer, a Select's index, a ScrollBox's offset).
//
// A component is a long-lived instance registered once. The app references it in
// the per-frame tree by id via a Slot node (`component: id`); before layout the
// Screen expands each Slot by calling the live instance's build(), so the
// instance — and its state — persists while its rendered nodes are thrown away
// and rebuilt. Lifecycle is a set-diff of referenced ids per frame (the only
// reconciliation-like bookkeeping, and it's a set, not a tree).

import type { KeyEvent } from '../platform/input.ts';
import type { Node } from './types.ts';

export interface Component {
  id: string;
  // This frame's subtree (plain data nodes). Wire the focusable node's onKey to
  // this instance's onKey so keys reach the live instance:
  //   Button({ id: this.id, ..., onKey: (ev) => this.onKey(ev) })
  build(): Node;
  // Returns true if the key was consumed (the focused node's onKey contract).
  onKey?(ev: KeyEvent): boolean;
  onMount?(): void; // fired once when first registered
  onUnmount?(): void; // fired when explicitly unmounted or dropped from the tree
  onFocus?(): void; // fired when keyboard focus enters this component
  onBlur?(): void; // fired when focus leaves it
  // Fired for a pointer-down outside every node rendered by this component,
  // including overlay descendants. Return true when internal state changed so
  // render-on-demand screens repaint (for example, an open dropdown closed).
  onPointerDownOutside?(): boolean;
}

// A live store of component instances, keyed by id. Dumb except for firing the
// mount/unmount lifecycle hooks; the per-frame set-diff lives in Screen and
// drives unmount() for components that leave the tree.
export class Registry {
  private map = new Map<string, Component>();

  mount(c: Component): void {
    if (this.map.has(c.id)) return; // already mounted — keep the live instance
    this.map.set(c.id, c);
    c.onMount?.();
  }

  unmount(id: string): void {
    const c = this.map.get(id);
    if (!c) return;
    this.map.delete(id);
    c.onUnmount?.();
  }

  get(id: string): Component | undefined {
    return this.map.get(id);
  }

  has(id: string): boolean {
    return this.map.has(id);
  }
}
