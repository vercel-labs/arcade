import assert from 'node:assert/strict';
import test from 'node:test';
import { STYLE_BOLD, type Surface } from '../engine/index.ts';
import { Button, Box } from './nodes.ts';
import { Tooltip } from './components/tooltip.ts';
import { Screen } from './screen.ts';
import type { KeyEvent } from '../platform/input.ts';

const BLACK: [number, number, number] = [0, 0, 0];

function rowText(surface: Surface, y: number): string {
  let out = '';
  for (let x = 0; x < surface.cols; x++) out += surface.getCell(x, y)?.ch ?? ' ';
  return out;
}

function findText(surface: Surface, needle: string): { x: number; y: number } | null {
  for (let y = 0; y < surface.rows; y++) {
    const x = rowText(surface, y).indexOf(needle);
    if (x >= 0) return { x, y };
  }
  return null;
}

test('Tooltip applies hover treatment and paints bold and normal copy above its trigger', () => {
  const trigger = Button({
    id: 'knight',
    label: 'card',
    style: { position: 'absolute', left: 10, top: 9, width: 12, height: 3, background: [20, 20, 24] },
  });
  const root = Box({ width: 40, height: 18 }, [Tooltip({
    content: [{ text: 'Knight', bold: true }, 'Place the robber on any tile.'],
    maxWidth: 24,
  }, trigger)]);
  const screen = new Screen(40, 18);
  screen.setRoot(root, { x: 0, y: 0, w: 40, h: 18 });

  const resting = screen.snapshot((surface) => surface.fillRect(0, 0, 40, 18, BLACK));
  assert.equal(findText(resting, 'Knight'), null, 'tooltip stays absent before hover');
  assert.deepEqual(resting.getCell(10, 9)?.bg, [20, 20, 24]);

  assert.equal(screen.hover(11, 10), true);
  const hovered = screen.snapshot((surface) => surface.fillRect(0, 0, 40, 18, BLACK));
  const title = findText(hovered, 'Knight');
  const body = findText(hovered, 'Place the robber');
  assert.ok(title && body, 'tooltip title and wrapped body are painted');
  assert.notEqual(hovered.getCell(10, 9)?.bg.join(','), '20,20,24', 'trigger receives the shared hover style');
  assert.ok((hovered.getCell(title.x, title.y)?.style ?? 0) & STYLE_BOLD, 'title is bold');
  assert.equal((hovered.getCell(body.x, body.y)?.style ?? 0) & STYLE_BOLD, 0, 'body remains normal weight');
  assert.ok(title.y < 9, 'tooltip prefers the space above its trigger');
  assert.ok(findText(hovered, '◥◤'), 'above placement uses an edge-connected downward tail');
});

test('Tooltip flips below a trigger at the top edge', () => {
  const screen = new Screen(24, 10);
  screen.setRoot(Box({ width: 24, height: 10 }, [Tooltip({
    content: 'edge tip',
    padding: 0,
  }, Button({
    id: 'edge',
    label: 'edge',
    style: { position: 'absolute', left: 8, top: 0, width: 8, height: 2, background: [20, 20, 24] },
  }))]), { x: 0, y: 0, w: 24, h: 10 });

  screen.hover(9, 1);
  const surface = screen.snapshot((s) => s.fillRect(0, 0, 24, 10, BLACK));
  const tip = findText(surface, 'edge tip');
  assert.ok(tip && tip.y > 1, 'tooltip uses the available space below');
  assert.ok(findText(surface, '◢◣'), 'below placement uses an edge-connected upward tail');
});

test('a passive Tooltip trigger can hover without becoming a click target', () => {
  const screen = new Screen(12, 4);
  screen.setRoot(Box({ width: 12, height: 4 }, [Tooltip({ id: 'passive', content: 'details' }, Box({
    position: 'absolute',
    left: 2,
    top: 1,
    width: 6,
    height: 2,
  }))]), { x: 0, y: 0, w: 12, h: 4 });

  assert.equal(screen.hover(3, 2), true, 'passive trigger participates in hover hit-testing');
  assert.equal(screen.pointerDown(3, 2), null, 'transparent passive trigger does not absorb scene clicks');
});

test('a disabled tooltip control is keyboard-readable but remains inert', () => {
  let activations = 0;
  const screen = new Screen(30, 8);
  screen.setRoot(Box({ width: 30, height: 8 }, [Tooltip({
    content: 'No city pieces remaining.',
  }, Button({
    id: 'city',
    label: 'city',
    disabled: true,
    onClick: () => { activations++; },
    style: { position: 'absolute', left: 10, top: 5, width: 8, height: 2, background: 'disabledBg' },
  }))]), { x: 0, y: 0, w: 30, h: 8 });
  const key = (name: string): KeyEvent => ({ name, raw: '', sequence: '', ctrl: false, shift: false, meta: false, eventType: 'press' });

  assert.equal(screen.handleKey(key('tab')), true);
  assert.equal((screen as unknown as { state: { focusId: string | null } }).state.focusId, 'city');
  const focused = screen.snapshot((surface) => surface.fillRect(0, 0, 30, 8, BLACK));
  assert.ok(findText(focused, 'No city pieces'));
  assert.equal(screen.handleKey(key('enter')), true);
  assert.equal(activations, 0);
});

test('keyboard navigation replaces a stationary pointer tooltip with the focused control', () => {
  const screen = new Screen(36, 10);
  screen.setRoot(Box({ width: 36, height: 10 }, [
    Tooltip({ content: 'Roads unavailable.' }, Button({
      id: 'road', label: 'road', disabled: true,
      style: { position: 'absolute', left: 4, top: 7, width: 8, height: 2, background: 'disabledBg' },
    })),
    Tooltip({ content: 'No valid city spot.' }, Button({
      id: 'city', label: 'city', disabled: true,
      style: { position: 'absolute', left: 16, top: 7, width: 8, height: 2, background: 'disabledBg' },
    })),
  ]), { x: 0, y: 0, w: 36, h: 10 });
  const tab: KeyEvent = { name: 'tab', raw: '\t', sequence: '\t', ctrl: false, shift: false, meta: false, eventType: 'press' };

  screen.hover(5, 8);
  screen.setFocus('road');
  assert.equal(screen.handleKey(tab), true);
  const focused = screen.snapshot((surface) => surface.fillRect(0, 0, 36, 10, BLACK));
  assert.ok(findText(focused, 'No valid city spot'));
  assert.equal(findText(focused, 'Roads unavailable'), null);
});

test('a pointer-focused tooltip closes when the pointer leaves its trigger', () => {
  const screen = new Screen(30, 8);
  screen.setRoot(Box({ width: 30, height: 8 }, [Tooltip({
    content: 'Build a road.',
  }, Button({
    id: 'road', label: 'road',
    style: { position: 'absolute', left: 10, top: 5, width: 8, height: 2, background: [20, 20, 24] },
  }))]), { x: 0, y: 0, w: 30, h: 8 });

  screen.hover(11, 6);
  screen.pointerDown(11, 6);
  assert.equal(screen.hover(1, 1), true);
  const left = screen.snapshot((surface) => surface.fillRect(0, 0, 30, 8, BLACK));
  assert.equal(findText(left, 'Build a road'), null);
});
