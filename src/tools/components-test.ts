// Headless behavior checks for the Phase 7 stateful components: typing into an
// Input, navigating a Select, nudging a Slider, scrolling a ScrollBox. Keys are
// synthetic KeyEvents fed to each component's onKey (the same path the Screen
// uses when the component is focused). No TTY — pure assertions.
//
//   pnpm exec tsx src/tools/components-test.ts

import { Input, Select, ScrollBox, Slider } from '../tui/index.ts';
import type { KeyEvent } from '../platform/input.ts';

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

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('\nall component-behavior assertions passed');
