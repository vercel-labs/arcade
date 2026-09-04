import assert from 'node:assert/strict';
import test from 'node:test';
import { createInputParser, type MouseEvent } from './input.ts';

test('SGR mouse parsing preserves vertical and horizontal scroll direction', () => {
  const events: MouseEvent[] = [];
  const parse = createInputParser({ onMouse: (event) => events.push(event) });

  parse('\x1b[<64;10;20M\x1b[<65;10;20M\x1b[<66;10;20M\x1b[<67;10;20M');

  assert.deepEqual(events.map(({ type, wheel, wheelAxis }) => ({ type, wheel, wheelAxis })), [
    { type: 'wheel', wheel: -1, wheelAxis: 'vertical' },
    { type: 'wheel', wheel: 1, wheelAxis: 'vertical' },
    { type: 'wheel', wheel: -1, wheelAxis: 'horizontal' },
    { type: 'wheel', wheel: 1, wheelAxis: 'horizontal' },
  ]);
});

test('SGR mouse parsing preserves modifiers on pointer presses', () => {
  const events: MouseEvent[] = [];
  const parse = createInputParser({ onMouse: (event) => events.push(event) });

  parse('\x1b[<28;7;9M'); // left press + Shift (4) + Meta (8) + Ctrl (16)

  assert.deepEqual(events, [{
    type: 'down', button: 0, x: 7, y: 9,
    shift: true, meta: true, ctrl: true,
  }]);
});
