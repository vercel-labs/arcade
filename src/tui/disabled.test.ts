import assert from 'node:assert/strict';
import test from 'node:test';
import { FilledButton, RoundedButton } from './button.ts';
import { focusOrder } from './focus.ts';
import { hitSurface, hitTest } from './hit.ts';
import { layout } from './layout.ts';
import { Box, Button } from './nodes.ts';
import { Screen } from './screen.ts';
import { defaultTheme } from './theme.ts';
import type { Node } from './types.ts';

const BLACK: [number, number, number] = [0, 0, 0];

// A one-button tree, laid out so the hit-testers have real boxes to work with.
function tree(disabled: boolean): { root: Node; button: Node } {
  const button = Button({ id: 'go', label: 'start', onClick: () => {}, disabled });
  const root = Box({ width: 20, height: 3 }, [button]);
  layout(root, { x: 0, y: 0, w: 20, h: 3 });
  return { root, button };
}

test('a disabled button is not a click target', () => {
  assert.equal(hitTest(tree(true).root, 1, 0), null);
});

test('an enabled button is a click target', () => {
  const { root, button } = tree(false);
  assert.equal(hitTest(root, 1, 0), button);
});

test('a disabled button still absorbs the gesture', () => {
  // Otherwise the press falls through to the scene and rotates the board behind a
  // button the player just tried to use.
  const { root, button } = tree(true);
  assert.equal(hitSurface(root, 1, 0), button);
});

test('a disabled button is skipped by Tab order', () => {
  assert.deepEqual(focusOrder(tree(true).root), []);
  assert.equal(focusOrder(tree(false).root).length, 1);
});

test('a disabled filled button paints the inert treatment, not the hovered one', () => {
  const screen = new Screen(20, 3);
  const button = FilledButton({ id: 'go', label: 'go', disabled: true });
  const root = Box({ width: 20, height: 3 }, [button]);
  screen.setRoot(root, { x: 0, y: 0, w: 20, h: 3 });
  // Force both interaction states on, the states that would otherwise win.
  screen.hover(2, 1);
  screen.setFocus('go');
  const surface = screen.snapshot((surf) => surf.fillRect(0, 0, 20, 3, BLACK));
  const cell = surface.getCell(2, 0);
  assert.deepEqual(cell?.bg, defaultTheme.disabledBg, 'background is the inert one');
  assert.deepEqual(cell?.fg, defaultTheme.disabledFg, 'ink is the inert one');
});

test('an enabled filled button still paints its focus treatment', () => {
  // Guards the change: suppressing states while disabled must not suppress them always.
  const screen = new Screen(20, 3);
  const button = FilledButton({ id: 'go', label: 'go', onClick: () => {} });
  const root = Box({ width: 20, height: 3 }, [button]);
  screen.setRoot(root, { x: 0, y: 0, w: 20, h: 3 });
  screen.setFocus('go');
  const surface = screen.snapshot((surf) => surf.fillRect(0, 0, 20, 3, BLACK));
  assert.deepEqual(surface.getCell(2, 0)?.bg, [86, 90, 108]);
});

test('RoundedButton ships an inert treatment instead of a lit one', () => {
  const off = RoundedButton({ id: 'go', label: 'start', disabled: true, color: [90, 190, 120] });
  assert.equal(off.disabled, true);
  assert.deepEqual(off.style.disabled, { color: 'disabledFg', borderColor: 'disabledFg', bold: false });
  // The lit states are still declared; paint is what ignores them while disabled.
  assert.ok(off.style.hover);
});

test('a caller can override the inert treatment through style', () => {
  // `disabled` on ButtonProps is the boolean flag, so overriding the overlay goes
  // through the `style` escape hatch, which merges last over the generated treatment.
  const off = RoundedButton({ id: 'go', label: 'start', disabled: true, style: { disabled: { color: 'danger' } } });
  assert.deepEqual(off.style.disabled, { color: 'danger' });
});

test('omitting disabled changes nothing', () => {
  const on = RoundedButton({ id: 'go', label: 'start', onClick: () => {} });
  assert.equal(on.disabled, undefined);
  assert.equal(focusOrder(Box({}, [on])).length, 1);
});
