// Behavior checks for the stateful components: typing into an Input, navigating a
// Select, nudging a Slider, scrolling a ScrollBox, and mouse routing through the
// real Screen. Keys are synthetic KeyEvents fed to each component's onKey (the
// same path the Screen uses when focused). No TTY — pure assertions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Box, Text, Slot } from './nodes.ts';
import { Dropdown } from './components/dropdown.ts';
import { Modal } from './components/modal.ts';
import { Input } from './components/input.ts';
import { Select } from './components/select.ts';
import { ScrollBox } from './components/scrollbox.ts';
import { Slider } from './components/slider.ts';
import { layout } from './layout.ts';
import { Screen } from './screen.ts';
import type { KeyEvent } from '../platform/input.ts';
import type { Node } from './types.ts';

const ok = (cond: boolean, msg: string): void => assert.ok(cond, msg);

// A printable character event (raw preserves case); name is the lowercase form.
const ch = (c: string): KeyEvent => ({ name: c.toLowerCase(), raw: c, sequence: c, ctrl: false, shift: c !== c.toLowerCase(), meta: false, eventType: 'press' });
const key = (name: string): KeyEvent => ({ name, raw: '', sequence: '', ctrl: false, shift: false, meta: false, eventType: 'press' });

test('Input: typing, editing, onChange/onEnter', () => {
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
});

test('Select: navigation, clamping, onSelect', () => {
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
});

test('Slider: step nudges + clamp', () => {
  const slider = new Slider({ id: 'sl', value: 0.5, step: 0.1 });
  slider.onKey(key('right'));
  ok(Math.abs(slider.value - 0.6) < 1e-9, "right nudges +step → 0.6");
  for (let i = 0; i < 10; i++) slider.onKey(key('left'));
  ok(slider.value === 0, 'left clamps at 0');
});

test('ScrollBox: scroll + clamp', () => {
  const sb = new ScrollBox({ id: 'sb', height: 3, rows: ['a', 'b', 'c', 'd', 'e'] });
  ok(sb.scroll === 0, 'starts at top');
  for (let i = 0; i < 5; i++) sb.onKey(key('down'));
  ok(sb.scroll === 2, 'down clamps at maxScroll (rows-height = 2)');
  sb.onKey(key('up'));
  ok(sb.scroll === 1, 'up scrolls back');
});

test('Dropdown searchable: filtering, editing, navigation, commit, and empty results', () => {
  let picked = -1;
  const queries: string[] = [];
  const combo = new Dropdown({
    id: 'combo',
    searchable: true,
    items: ['GPT-5', 'Claude Sonnet 4.5', 'Gemini Flash', 'Mistral Large'],
    width: 24,
    index: 0,
    onSelect: (i) => (picked = i),
    onQueryChange: (query) => queries.push(query),
  });

  ok(combo.value === 'GPT-5' && combo.query === '', 'committed value is visible while the query is empty');
  combo.onKey(key('enter'));
  for (const c of 'flash') combo.onKey(ch(c));
  ok(combo.open && combo.query === 'flash' && combo.value === 'GPT-5', 'typing filters without changing the committed value');
  assert.deepEqual(combo.filteredItems, ['Gemini Flash'], 'filtering is case-insensitive');
  combo.onKey(key('enter'));
  ok(picked === 2 && combo.index === 2 && combo.value === 'Gemini Flash', 'Enter commits the filtered original item');
  ok(combo.query === '' && !combo.open, 'commit clears the live query and closes the list');

  combo.onKey(key('enter')); // opens with committed Gemini highlighted
  combo.onKey(key('up'));
  combo.onKey(key('up')); // move to GPT-5
  combo.onKey(key('enter'));
  ok(combo.index === 0, 'Up/Down navigate actual options before committing');

  combo.onKey(key('enter'));
  combo.onKey({ ...ch('x'), raw: 'Claude ' });
  ok(combo.query === 'Claude ', 'a multi-character input event is inserted as pasted text');
  combo.onKey(key('backspace'));
  ok(combo.query === 'Claude', 'Backspace edits the live query');
  combo.onKey(key('escape'));
  ok(combo.query === '' && !combo.open && combo.value === 'GPT-5', 'Escape clears search but preserves the committed value');

  combo.onKey(key('enter'));
  combo.onKey(ch('z'));
  combo.onKey(ch('z'));
  ok(combo.filteredItems.length === 0, 'an unmatched query produces an empty result set');
  const empty = (combo.build().children ?? []).find((node) => node.overlay && node.children?.[0]?.text === 'No matches');
  ok(empty != null, 'the open list renders an explicit empty state below search');
  ok(queries.includes('flash') && queries.includes(''), 'query changes are observable by owners');
});

test('Dropdown searchable: native-style cursor movement and deletion', () => {
  const combo = new Dropdown({ id: 'editing-combo', searchable: true, items: [], width: 24 });
  combo.onKey(key('enter'));
  combo.setQuery('alpha beta');

  combo.onKey(key('left'));
  ok(combo.caret === 9, 'Left moves the cursor by one character');
  combo.onKey({ ...key('left'), meta: true });
  ok(combo.caret === 6, 'Option/Alt-Left moves to the previous word');
  combo.onKey({ ...key('left'), super: true });
  ok(combo.caret === 0, 'Command/Super-Left moves to the start of the line');
  combo.onKey({ ...key('right'), super: true });
  ok(combo.caret === combo.query.length, 'Command/Super-Right moves to the end of the line');

  combo.onKey({ ...key('backspace'), meta: true });
  ok(combo.query === 'alpha ' && combo.caret === 6, 'Option/Alt-Backspace deletes the previous word');
  combo.onKey({ ...key('backspace'), super: true });
  ok(combo.query === '' && combo.caret === 0, 'Command/Super-Backspace deletes to the start of the line');

  combo.setQuery('alpha beta');
  combo.onKey(key('home'));
  combo.onKey({ ...key('delete'), meta: true });
  ok(combo.query === 'beta' && combo.caret === 0, 'Option/Alt-Delete deletes the next word');
  combo.onKey({ ...key('delete'), super: true });
  ok(combo.query === '', 'Command/Super-Delete deletes to the end of the line');
});

test('Dropdown searchable: cursor is hidden initially, filled on focus, and hidden on blur', () => {
  const combo = new Dropdown({ id: 'cursor-combo', searchable: true, items: [], width: 16 });
  const screen = new Screen(24, 6);
  const region = { x: 0, y: 0, w: 24, h: 6 };
  screen.mount(combo);
  const relayout = (): void => screen.setRoot(Box({}, [Slot('cursor-combo')]) as Node, region);

  relayout();
  screen.pointerDown(3, 1);
  ok(combo.open && combo.query === '', 'clicking the committed field opens the list without activating search');
  relayout();
  assert.notDeepEqual(screen.snapshot(() => {}).getCell(3, 1)?.bg, [131, 165, 152], 'the search placeholder has no cursor');

  screen.pointerDown(4, 2); // first query boundary, after the icon
  ok(combo.caret === 0, 'clicking search activates a real empty input buffer');
  relayout();
  const focused = screen.snapshot(() => {}).getCell(3, 1);
  assert.deepEqual(focused?.bg, [131, 165, 152], 'focused cursor is a filled #83A598 cell');

  for (const c of 'abc') screen.handleKey(ch(c));
  ok(combo.query === 'abc' && combo.caret === 3, 'typing advances the search cursor');
  relayout();
  assert.deepEqual(screen.snapshot(() => {}).getCell(6, 1)?.bg, [131, 165, 152], 'cursor stays immediately after typed text');

  screen.pointerDown(5, 2); // query boundary between a and b
  ok(combo.caret === 1, 'clicking between query characters places the cursor at that boundary');
  screen.handleKey(ch('X'));
  ok(combo.query === 'aXbc' && combo.caret === 2, 'typing inserts at the clicked position and advances the cursor');
  screen.handleKey(key('left'));
  screen.handleKey(ch('Y'));
  ok(combo.query === 'aYXbc' && combo.caret === 2, 'Left moves between characters and typing uses the new position');

  relayout();
  screen.pointerDown(20, 2);
  ok(combo.caret === combo.query.length, 'clicking past the text places the cursor at the right edge');

  screen.setFocus(null);
  relayout();
  assert.notDeepEqual(screen.snapshot(() => {}).getCell(3, 1)?.bg, [131, 165, 152], 'blur removes the cyan cursor cell');
  ok(combo.query === '' && !combo.open, 'blur clears the transient filter and closes the list');
});

test('Dropdown searchable: filtering never mutates the committed selection', () => {
  const combo = new Dropdown({ id: 'default-combo', searchable: true, items: ['GPT-5', 'GPT-5 Mini'], width: 18, index: 0 });
  const screen = new Screen(24, 5);
  const region = { x: 0, y: 0, w: 24, h: 5 };
  screen.mount(combo);
  const relayout = (): void => screen.setRoot(Box({}, [Slot('default-combo')]) as Node, region);

  relayout();
  ok(combo.value === 'GPT-5' && combo.query === '', 'default starts as a committed display value');
  screen.pointerDown(5, 1);
  ok(combo.open && combo.query === '', 'opening preserves the committed value and starts with all options');
  relayout();
  screen.pointerDown(4, 2);
  for (const c of 'Mini') screen.handleKey(ch(c));
  const field = combo.build().children?.[0];
  ok(combo.value === 'GPT-5' && combo.query === 'Mini' && field?.text?.startsWith('GPT-5') === true, 'a partial filter never replaces the closed-field selection');
  screen.handleKey(key('enter'));
  ok(combo.value === 'GPT-5 Mini' && combo.query === '' && !combo.open, 'only committing an actual option changes the selection');
});

test('Dropdown searchable: search row is sticky above seven scrolling options', () => {
  const combo = new Dropdown({ id: 'sticky-combo', searchable: true, items: Array.from({ length: 10 }, (_, i) => `Model ${i + 1}`), width: 18, rows: 7, index: 0 });
  combo.onKey(key('enter'));

  const before = combo.build().children ?? [];
  const search = before.find((node) => node.id === 'sticky-combo-search');
  const list = before.find((node) => node.overlay && node.children?.length === 7);
  ok(search?.text === '⌕ Search' && search.style.top === 1, 'search is the first sticky dropdown row');
  ok(list?.style.top === 2 && list.children?.length === 7, 'exactly seven option rows render below search');
  const firstBefore = list?.children?.[0]?.id;

  combo.onKey(key('pagedown'));
  const after = combo.build().children ?? [];
  const stickySearch = after.find((node) => node.id === 'sticky-combo-search');
  const scrolledList = after.find((node) => node.overlay && node.children?.length === 7);
  ok(stickySearch?.text === '⌕ Search' && scrolledList?.children?.[0]?.id !== firstBefore, 'scrolling options does not move the search row');
});

test('Dropdown searchable: field and option mouse targets are independent', () => {
  let picked = -1;
  const combo = new Dropdown({ id: 'mouse-combo', searchable: true, items: ['Alpha', 'Beta', 'Gamma'], width: 12, rows: 3, onSelect: (i) => (picked = i) });
  const screen = new Screen(40, 10);
  const region = { x: 0, y: 0, w: 40, h: 10 };
  screen.mount(combo);
  const relayout = (): void => screen.setRoot(Box({}, [Slot('mouse-combo')]) as Node, region);

  relayout();
  screen.pointerDown(12, 1); // rightmost field cells are the dedicated chevron
  ok(combo.open && combo.query === '', 'clicking the chevron opens without editing the query');
  relayout();
  screen.pointerDown(2, 4); // second option row below sticky search
  ok(picked === 1 && combo.index === 1 && !combo.open, 'clicking an option commits and closes');

  relayout();
  screen.pointerDown(12, 1);
  ok(combo.open, 'the chevron reopens the list');
  relayout();
  screen.pointerDown(12, 1);
  ok(!combo.open, 'the same chevron toggles the list closed');
});
test('Dropdown searchable: outside clicks close the list and clear focus', () => {
  const combo = new Dropdown({ id: 'outside-combo', searchable: true, items: ['Alpha', 'Beta'], width: 12, index: 0 });
  const screen = new Screen(24, 6);
  const region = { x: 0, y: 0, w: 24, h: 6 };
  screen.mount(combo);
  const relayout = (): void => screen.setRoot(Box({}, [Slot('outside-combo')]) as Node, region);

  relayout();
  screen.pointerDown(3, 1);
  combo.setQuery('zz');
  relayout();
  screen.pointerDown(2, 3);
  ok(combo.open, 'a click in the floating empty-result row stays inside the dropdown');

  screen.pointerDown(24, 6);
  ok(!combo.open, 'a click on the transparent scene closes the open list');
  relayout();
  const query = combo.query;
  ok(!screen.handleKey(ch('x')) && combo.query === query, 'the outside click also removes keyboard focus');
});

test('Modal: card clicks stay inside and scrim clicks dismiss', () => {
  let dismissals = 0;
  const modal = Modal(Box({ width: 12, height: 4, background: 'pillBg' }), { onDismiss: () => dismissals++ });
  const screen = new Screen(40, 12);
  screen.setRoot(modal, { x: 0, y: 0, w: 40, h: 12 });

  const card = modal.children?.[0]?.layout;
  ok(card != null, 'the modal card is laid out');
  screen.pointerDown((card?.x ?? 0) + 1, (card?.y ?? 0) + 1);
  ok(dismissals === 0, 'clicking blank space inside the card does not dismiss');

  screen.pointerDown(1, 1);
  ok(dismissals === 1, 'clicking the scrim dismisses the modal');
});

test('nested overlays paint and hit above later children of an outer overlay', () => {
  const nested: Node = {
    ...Text({ text: 'TOP', id: 'nested', style: { position: 'absolute', top: 1, left: 0, width: 8, background: [20, 80, 120] } }),
    overlay: true,
    onMouse: () => true,
  };
  const cover: Node = {
    ...Text({ text: 'COVER', id: 'cover', style: { position: 'absolute', top: 1, left: 0, width: 8, background: [120, 20, 20] } }),
    onMouse: () => true,
  };
  const outer: Node = {
    ...Box({ width: 8, height: 3, background: [10, 10, 10] }, [nested, cover]),
    overlay: true,
  };
  const screen = new Screen(12, 5);
  screen.setRoot(Box({}, [outer]), { x: 0, y: 0, w: 12, h: 5 });

  const cell = screen.snapshot(() => {}).getCell(0, 1);
  ok(cell?.ch === 'T', 'nested dropdown layer paints over a later subtitle/field');
  const target = screen.pointerDown(1, 2);
  ok(target?.id === 'nested', 'nested dropdown layer also receives the topmost mouse hit');
});

// Mouse routing through the real Screen: pointerDown hit-tests + captures, drag
// routes to the captured node, wheel routes to the hovered node — with local
// coordinates. Each component is mounted alone at the top-left so its layout box
// is at (0,0) and screen cell N maps to local N-1.
test('mouse (via Screen): capture, wheel, overlays, wrapping', () => {
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
  const restingArrow = s4.snapshot(() => {}).getCell(10, 0)?.bg;
  s4.hover(12, 1);
  const hovered = s4.snapshot(() => {});
  assert.notDeepEqual(hovered.getCell(10, 0)?.bg, restingArrow, 'Dropdown: hovering changes the arrow-side background');
  assert.deepEqual(hovered.getCell(0, 0)?.bg, hovered.getCell(10, 0)?.bg, 'Dropdown: label and arrow hover as one field');

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
});

// Propagation: a panel with a background absorbs the pointer (so a drag/scroll
// there doesn't reach the scene behind it), while a transparent area passes
// through. pointerDown returns non-null = "absorbed"; wheel returns true = "block
// scene zoom". The panel (bg) occupies cells (0,0)-(19,4); the rest is the
// transparent root.
test('propagation: panel blocks scene, transparent area passes through', () => {
  const s = new Screen(40, 10);
  const tree = Box({ width: 40, height: 10 }, [Box({ width: 20, height: 5, background: [10, 10, 10] }, [])]) as Node;
  s.setRoot(tree, { x: 0, y: 0, w: 40, h: 10 });
  ok(s.pointerDown(3, 3) != null, 'click on the panel background is absorbed (no camera drag)');
  s.pointerUp();
  ok(s.pointerDown(30, 8) == null, 'click on the transparent area passes through (null → scene)');
  s.pointerUp();
  ok(s.wheel(3, 3, 1) === true, 'wheel over the panel is blocked from the scene');
  ok(s.wheel(30, 8, 1) === false, 'wheel over the transparent area reaches the scene');
});
