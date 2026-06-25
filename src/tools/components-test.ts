// Headless behavior checks for the Phase 7 stateful components: typing into an
// Input, navigating a Select, nudging a Slider, scrolling a ScrollBox. Keys are
// synthetic KeyEvents fed to each component's onKey (the same path the Screen
// uses when the component is focused). No TTY — pure assertions.
//
//   pnpm exec tsx src/tools/components-test.ts

import { Box, Input, Screen, Select, ScrollBox, Slider, Slot } from '../tui/index.ts';
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

// A printable character event (raw preserves case); name is the lowercase form.
const ch = (c: string): KeyEvent => ({ name: c.toLowerCase(), raw: c, sequence: c, ctrl: false, shift: c !== c.toLowerCase(), meta: false, eventType: 'press' });
const key = (name: string): KeyEvent => ({ name, raw: '', sequence: '', ctrl: false, shift: false, meta: false, eventType: 'press' });

console.log('Input:');
{
  const changes: string[] = [];
  let entered: string | null = null;
  const input = new Input({ id: 'i', onChange: (v) => changes.push(v), onEnter: (v) => (entered = v) });
  for (const c of 'Nf3') input.onKey(ch(c));
  ok(input.value === 'Nf3' && input.caret === 3, "typing 'Nf3' fills value, caret at end");
  input.onKey(key('left'));
  input.onKey(key('backspace'));
  ok(input.value === 'N3', "left then backspace deletes 'f' → 'N3'");
  ok(changes[changes.length - 1] === 'N3', 'onChange fired with latest value');
  input.onKey(key('enter'));
  ok(entered === 'N3', 'Enter fires onEnter with the value');
  ok(input.onKey(key('tab')) === false, 'Tab is not consumed (falls through to focus cycling)');
}

console.log('Select:');
{
  let chosen = -1;
  const sel = new Select({ id: 's', items: ['a', 'b', 'c'], onSelect: (i) => (chosen = i) });
  ok(sel.index === 0, 'starts at index 0');
  sel.onKey(key('down'));
  sel.onKey(key('j'));
  ok(sel.index === 2, "down + 'j' advance to index 2");
  sel.onKey(key('down'));
  ok(sel.index === 2, 'clamps at the last item');
  sel.onKey(key('enter'));
  ok(chosen === 2, 'Enter fires onSelect with the current index');
  ok(sel.onKey(key('tab')) === false, 'Tab falls through');
}

console.log('Slider:');
{
  const slider = new Slider({ id: 'sl', value: 0.5, step: 0.1 });
  slider.onKey(key('right'));
  ok(Math.abs(slider.value - 0.6) < 1e-9, "right nudges +step → 0.6");
  for (let i = 0; i < 10; i++) slider.onKey(key('left'));
  ok(slider.value === 0, 'left clamps at 0');
}

console.log('ScrollBox:');
{
  const sb = new ScrollBox({ id: 'sb', height: 3, rows: ['a', 'b', 'c', 'd', 'e'] });
  ok(sb.scroll === 0, 'starts at top');
  for (let i = 0; i < 5; i++) sb.onKey(key('down'));
  ok(sb.scroll === 2, 'down clamps at maxScroll (rows-height = 2)');
  sb.onKey(key('up'));
  ok(sb.scroll === 1, 'up scrolls back');
}

// Mouse routing through the real Screen: pointerDown hit-tests + captures, drag
// routes to the captured node, wheel routes to the hovered node — with local
// coordinates. Each component is mounted alone at the top-left so its layout box
// is at (0,0) and screen cell N maps to local N-1.
console.log('mouse (via Screen):');
{
  const region = { x: 0, y: 0, w: 40, h: 8 };

  // Slider: click sets value from x; drag updates it continuously.
  const slider = new Slider({ id: 'sl', width: 20, value: 0 });
  const s1 = new Screen(40, 8);
  s1.mount(slider);
  s1.setRoot(Box({}, [Slot('sl')]) as Node, region);
  s1.pointerDown(11, 1); // local x = 10 → 10/19
  ok(Math.abs(slider.value - 10 / 19) < 1e-9, 'Slider: click at x=10 sets value 10/19');
  s1.drag(1, 1); // local x = 0 → value 0
  ok(slider.value === 0, 'Slider: drag to x=0 sets value 0 (capture routes the drag)');
  s1.pointerUp();
  s1.drag(20, 1); // after release: no capture → no change
  ok(slider.value === 0, 'Slider: drag after pointerUp does nothing (capture released)');

  // Select: click selects the row under the cursor; wheel moves selection.
  let chosen = -1;
  const sel = new Select({ id: 'se', items: ['a', 'b', 'c', 'd'], height: 4, onSelect: (i) => (chosen = i) });
  const s2 = new Screen(40, 8);
  s2.mount(sel);
  s2.setRoot(Box({}, [Slot('se')]) as Node, region);
  s2.pointerDown(1, 3); // local y = 2 → row 2
  ok(sel.index === 2 && chosen === 2, 'Select: click row 2 selects + commits it');
  s2.wheel(1, 1, -1);
  ok(sel.index === 1, 'Select: wheel up moves selection to 1');

  // ScrollBox: wheel scrolls; drag on the scrollbar column jumps position.
  const sb = new ScrollBox({ id: 'sb', width: 10, height: 4, rows: ['1', '2', '3', '4', '5', '6', '7', '8'] });
  const s3 = new Screen(40, 8);
  s3.mount(sb);
  s3.setRoot(Box({}, [Slot('sb')]) as Node, region);
  s3.wheel(1, 1, 1);
  ok(sb.scroll === 1, 'ScrollBox: wheel down scrolls by 1');
  s3.pointerDown(10, 4); // scrollbar column (x=9 = w-1), bottom → max scroll
  ok(sb.scroll === sb.rows.length - 4, 'ScrollBox: click bottom of scrollbar jumps to max scroll');
}

// Propagation: a panel with a background absorbs the pointer (so a drag/scroll
// there doesn't reach the scene behind it), while a transparent area passes
// through. pointerDown returns non-null = "absorbed"; wheel returns true = "block
// scene zoom". The panel (bg) occupies cells (0,0)-(19,4); the rest is the
// transparent root.
console.log('propagation (panel blocks scene):');
{
  const s = new Screen(40, 10);
  const tree = Box({ width: 40, height: 10 }, [Box({ width: 20, height: 5, background: [10, 10, 10] }, [])]) as Node;
  s.setRoot(tree, { x: 0, y: 0, w: 40, h: 10 });
  ok(s.pointerDown(3, 3) != null, 'click on the panel background is absorbed (no camera drag)');
  s.pointerUp();
  ok(s.pointerDown(30, 8) == null, 'click on the transparent area passes through (null → scene)');
  s.pointerUp();
  ok(s.wheel(3, 3, 1) === true, 'wheel over the panel is blocked from the scene');
  ok(s.wheel(30, 8, 1) === false, 'wheel over the transparent area reaches the scene');
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('\nall component-behavior assertions passed');
