// Headless behavior checks for the Phase 7 stateful components: typing into an
// Input, navigating a Select, nudging a Slider, scrolling a ScrollBox. Keys are
// synthetic KeyEvents fed to each component's onKey (the same path the Screen
// uses when the component is focused). No TTY — pure assertions.
//
//   pnpm exec tsx src/tools/tui-inputs-test.ts

import { Box, Dropdown, Input, layout, Screen, Select, ScrollBox, Slider, Slot, Text } from '../tui/index.ts';
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
  ok(sb.scroll === 3, 'ScrollBox: wheel down scrolls by the wheel step (3)');
  s3.pointerDown(10, 4); // scrollbar column (x=9 = w-1), bottom → max scroll
  ok(sb.scroll === sb.rows.length - 4, 'ScrollBox: click bottom of scrollbar jumps to max scroll');

  // ScrollBox autoHeight: the box is only as tall as its rows until it hits the
  // cap, then it stops growing and the wheel scrolls (no fixed empty viewport).
  const ag = new ScrollBox({ id: 'ag', width: 10, height: 4, rows: [], autoHeight: true });
  ok(ag.build().style.height === 0, 'ScrollBox autoHeight: empty → 0 rows tall (no empty viewport)');
  ag.rows = ['a', 'b'];
  ok(ag.build().style.height === 2, 'ScrollBox autoHeight: grows to fit content (2 rows)');
  ag.rows = ['a', 'b', 'c', 'd', 'e', 'f'];
  ok(ag.build().style.height === 4, 'ScrollBox autoHeight: caps at its max height (4)');
  ag.onMouse({ type: 'wheel', x: 0, y: 0, w: 10, h: 4, wheel: 1 });
  ok(ag.scroll === 2, 'ScrollBox autoHeight: scrolls once content exceeds the cap (max scroll 6-4=2)');

  // Dropdown: closed by default; clicking the field opens the list; clicking a
  // list row commits it and collapses; blur (focus elsewhere) also collapses.
  let picked = -1;
  const dd = new Dropdown({ id: 'dd', items: ['a', 'b', 'c', 'd', 'e'], width: 12, rows: 3, onSelect: (i) => (picked = i) });
  const s4 = new Screen(40, 10);
  s4.mount(dd);
  // Re-lay out after each state change (setRoot expands the Slot to the dropdown's
  // current open/closed size) so the next hit-test sees the live geometry — the
  // app re-renders every interaction; the bare harness must do it explicitly.
  const relayout = (): void => s4.setRoot(Box({}, [Slot('dd')]) as Node, region);
  relayout();
  ok(!dd.open && dd.index === -1, 'Dropdown: starts closed with no committed selection');
  s4.pointerDown(1, 1); // field row (local y=0) → open
  ok(dd.open, 'Dropdown: clicking the field opens the list');
  relayout(); // list now occupies rows 1..3
  s4.pointerDown(1, 3); // list row (local y=2) → row index 1 (scroll 0) → commit
  ok(dd.index === 1 && picked === 1 && !dd.open, 'Dropdown: clicking a list row commits it and closes');
  relayout();
  s4.pointerDown(1, 1); // reopen
  ok(dd.open, 'Dropdown: reopens on a second field click');
  dd.onBlur(); // focus moves away
  ok(!dd.open, 'Dropdown: loses focus → collapses');

  // Dropdown overlay: an open list is out of flow — its wrapper stays one row, a
  // sibling below it doesn't move, and the floating list is laid out over them.
  const big = new Dropdown({ id: 'big', items: Array.from({ length: 10 }, (_, i) => `i${i}`), width: 12, rows: 3 });
  big.onKey(key('enter')); // open
  const wrap = big.build();
  const tree = Box({ flexDirection: 'column' }, [wrap, Text({ text: 'BELOW' })]);
  layout(tree, region);
  const list = (wrap.children ?? []).find((c) => c.overlay);
  ok(wrap.layout?.h === 1, 'Dropdown overlay: open wrapper stays 1 row (list is out of flow)');
  ok(tree.children?.[1].layout?.y === (wrap.layout?.y ?? 0) + 1, 'Dropdown overlay: sibling below is not pushed down');
  ok(list?.layout?.y === (wrap.layout?.y ?? 0) + 1 && list?.layout?.h === 3, 'Dropdown overlay: floating list sits below the field, 3 rows tall');

  // Dropdown scrolling: wheel + scrollbar move the VIEW (like ScrollBox), leaving
  // the committed selection untouched; ↑/↓ would move the highlight instead.
  const firstVisible = (): string | undefined => ((big.build().children ?? []).find((c) => c.overlay)?.children ?? [])[0]?.text;
  list?.onMouse?.({ type: 'wheel', x: 0, y: 0, w: 12, h: 3, wheel: 1 });
  ok(firstVisible() === 'i3' && big.index === -1, 'Dropdown: wheel scrolls the list view by the step (no commit)');
  list?.onMouse?.({ type: 'down', x: 11, y: 2, w: 12, h: 3 }); // bottom of the scrollbar column → max scroll
  ok(firstVisible() === 'i7', 'Dropdown: dragging the scrollbar jumps the view to the bottom');

  // Dropdown wrapping: an option too long for the width wraps onto extra lines
  // (no truncation), and the whole wrapped item highlights + selects as one block.
  let wpicked = -1;
  const wd = new Dropdown({ id: 'wd', items: ['Short', 'Gemini 3.1 Flash Image Preview'], width: 14, rows: 6, onSelect: (i) => (wpicked = i) });
  wd.onKey(key('enter')); // open
  const wlist = (): Node | undefined => (wd.build().children ?? []).find((c) => c.overlay);
  const wlines = (): Node[] => wlist()?.children ?? [];
  // 'Short' = 1 line; the long name wraps to ≥2 (width 14 → inner ≈ 11), so ≥3 total.
  ok(wlines().length >= 3, `wrapping: long option spans multiple lines (${wlines().length} lines)`);
  ok(wlines().every((n) => (n.text ?? '').length <= 11), 'wrapping: no line exceeds the inner width (nothing cut off)');
  // Highlight the long (2nd) item; all of its lines should carry the accent bg.
  wd.onKey(key('down')); // highlight item 1 (the long one)
  const litLines = wlines().filter((n) => n.style.background === 'pillHoverBg');
  ok(litLines.length >= 2, `wrapping: the whole wrapped item highlights (${litLines.length} highlighted lines)`);
  // Clicking any line of the wrapped item commits that ITEM (index 1).
  const wsel = wlist();
  wsel?.onMouse?.({ type: 'down', x: 1, y: 2, w: 14, h: wlines().length }); // a lower line of the long item
  ok(wpicked === 1 && wd.index === 1, 'wrapping: clicking a wrapped line selects the whole item');
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
