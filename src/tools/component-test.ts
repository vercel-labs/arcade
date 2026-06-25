// Headless proof for the Phase 6 persistent-component substrate: a Counter whose
// state survives the per-frame tree rebuild, with lifecycle (onMount/onUnmount/
// onFocus/onBlur) and key routing through the live instance. No TTY — pure
// assertions, exit non-zero on failure.
//
//   pnpm exec tsx src/tools/component-test.ts

import { Box, Button, Screen, Slot, type Component } from '../tui/index.ts';
import type { KeyEvent } from '../platform/input.ts';
import type { Node } from '../tui/types.ts';

let failures = 0;
function ok(cond: boolean, msg: string): void {
  if (!cond) {
    failures++;
    console.error(`  ✗ ${msg}`);
  } else {
    console.log(`  ✓ ${msg}`);
  }
}

// A counter component. Its `count` lives on the instance, so it must survive the
// tree being rebuilt every frame. '+' / space increments; the build() wires its
// focusable node's onKey back to the instance.
class Counter implements Component {
  id = 'counter';
  count = 0;
  mounts = 0;
  unmounts = 0;
  focuses = 0;
  blurs = 0;
  onMount(): void {
    this.mounts++;
  }
  onUnmount(): void {
    this.unmounts++;
  }
  onFocus(): void {
    this.focuses++;
  }
  onBlur(): void {
    this.blurs++;
  }
  onKey(ev: KeyEvent): boolean {
    if (ev.name === '+' || ev.name === 'space') {
      this.count++;
      return true;
    }
    return false;
  }
  build(): Node {
    return Button({ id: this.id, label: `count: ${this.count}`, onKey: (ev) => this.onKey(ev) });
  }
}

// Find a node's text by id in a (post-expand) tree.
function textOf(root: Node, id: string): string | undefined {
  if (root.id === id) return root.text;
  for (const c of root.children ?? []) {
    const t = textOf(c, id);
    if (t !== undefined) return t;
  }
  return undefined;
}

const key = (name: string): KeyEvent => ({ name, raw: name, sequence: name, ctrl: false, shift: false, meta: false, eventType: 'press' });
const REGION = { x: 0, y: 0, w: 40, h: 5 };

const screen = new Screen(40, 5);
const counter = new Counter();
screen.mount(counter);
ok(counter.mounts === 1, 'onMount fired once on mount()');

// Frame 1: reference the counter via a Slot. expand() runs in setRoot.
const tree1: Node = Box({}, [Slot('counter')]);
screen.setRoot(tree1, REGION);
ok(textOf(tree1, 'counter') === 'count: 0', 'frame 1: Slot expanded to "count: 0"');

// Focus it and press space twice — keys route to the live instance.
screen.setFocus('counter');
screen.handleKey(key('space'));
screen.handleKey(key('space'));
ok(counter.count === 2, 'two space presses → count 2 (keys reached the instance)');

// Frame 2: a brand-new tree (the old one is thrown away). The SAME instance
// rebuilds, so its count survives the rebuild.
const tree2: Node = Box({}, [Slot('counter')]);
screen.setRoot(tree2, REGION);
ok(textOf(tree2, 'counter') === 'count: 2', 'frame 2: rebuilt tree shows surviving "count: 2"');
ok(counter.mounts === 1, 'onMount did NOT fire again across the rebuild');
ok(counter.focuses === 1 && counter.blurs === 0, 'onFocus fired once, no blur while still focused');

// Frame 3: Slot dropped from the tree → auto-unmount + onBlur (it was focused).
screen.setRoot(Box({}, []), REGION);
ok(counter.unmounts === 1, 'onUnmount fired when the Slot left the tree');
ok(counter.blurs === 1, 'onBlur fired as the focused component left');
ok(screen.component('counter') === undefined, 'instance removed from the registry');

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('\nall component-substrate assertions passed');
