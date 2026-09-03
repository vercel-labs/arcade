import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { resizeTerminalRect, type ResizeDirection } from '../components/quick-terminal-resize.ts';

const origin = { left: 200, top: 100, width: 600, height: 500 };

test('each resize direction moves only its named edges', () => {
  const expected: Record<ResizeDirection, [number, number, number, number]> = {
    n: [200, 80, 600, 520], ne: [200, 80, 630, 520], e: [200, 100, 630, 500], se: [200, 100, 630, 540],
    s: [200, 100, 600, 540], sw: [170, 100, 630, 540], w: [170, 100, 630, 500], nw: [170, 80, 630, 520],
  };
  for (const direction of Object.keys(expected) as ResizeDirection[]) {
    const rect = resizeTerminalRect(origin, direction, direction.includes('w') ? -30 : 30, direction.includes('n') ? -20 : 40, 1200, 900, 300, 240);
    assert.deepEqual([rect.left, rect.top, rect.width, rect.height], expected[direction], direction);
  }
});

test('resize geometry respects minimum dimensions and viewport margins', () => {
  assert.deepEqual(resizeTerminalRect(origin, 'nw', 1_000, 1_000, 1200, 900, 300, 240), { left: 500, top: 360, width: 300, height: 240 });
  assert.deepEqual(resizeTerminalRect(origin, 'nw', -1_000, -1_000, 1200, 900, 300, 240), { left: 8, top: 8, width: 792, height: 592 });
  assert.deepEqual(resizeTerminalRect(origin, 'se', 1_000, 1_000, 1200, 900, 300, 240), { left: 200, top: 100, width: 992, height: 792 });
  assert.deepEqual(resizeTerminalRect(origin, 'se', -1_000, -1_000, 1200, 900, 300, 240), { left: 200, top: 100, width: 300, height: 240 });
});

test('the terminal window resizes from every edge and corner', async () => {
  const [component, css] = await Promise.all([
    readFile(new URL('../components/quick-terminal.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./global.css', import.meta.url), 'utf8'),
  ]);

  assert.match(component, /\['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'\]/);
  assert.match(component, /data-resize-direction=\{direction\}/);
  for (const direction of ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']) {
    assert.match(css, new RegExp(`data-resize-direction='${direction}'`));
  }
  assert.match(component, /resizeTerminalRect\(/);
  assert.match(css, /data-resize-direction='se'\]::after/);
  assert.match(css, /@media \(pointer: coarse\) \{\s*\.quick-terminal-resize-handle \{ display: none; \}/);
});

test('hovering or focusing the traffic-light group reveals every symbol', async () => {
  const [component, css] = await Promise.all([
    readFile(new URL('../components/quick-terminal.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./global.css', import.meta.url), 'utf8'),
  ]);
  assert.equal(component.match(/className="quick-terminal-control-icon"/g)?.length, 3);
  assert.match(css, /\.quick-terminal-controls:hover \.quick-terminal-control-icon/);
  assert.match(css, /\.quick-terminal-controls:focus-within \.quick-terminal-control-icon/);
  assert.match(css, /button\.quick-terminal-control:focus-visible \{[^}]*outline: 2px solid #fff;[^}]*outline-offset: 2px;/);
  assert.doesNotMatch(css, /quick-terminal-control--maximize::after[^\n]*content: '\+'/);
});
