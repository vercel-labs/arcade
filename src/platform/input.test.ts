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
