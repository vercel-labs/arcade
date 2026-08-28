import assert from 'node:assert/strict';
import test from 'node:test';
import { Box, Text } from './nodes.ts';
import { Screen } from './screen.ts';
import { createTheme } from './theme.ts';

test('Screen resolves semantic colors from its active theme and can replace it', () => {
  const first = createTheme({
    surfaceChrome: [11, 22, 33],
    textPrimary: [101, 102, 103],
  });
  const second = createTheme({
    surfaceChrome: [44, 55, 66],
    textPrimary: [201, 202, 203],
  });
  const screen = new Screen(8, 2, first);
  screen.setRoot(Box({ width: 8, height: 2, background: 'surfaceChrome' }, [Text({ text: 'themed' })]), { x: 0, y: 0, w: 8, h: 2 });

  const before = screen.snapshot(() => {});
  assert.deepEqual(before.getCell(0, 0)?.bg, [11, 22, 33]);
  assert.deepEqual(before.getCell(0, 0)?.fg, [101, 102, 103]);

  screen.setTheme(second);
  const after = screen.snapshot(() => {});
  assert.deepEqual(after.getCell(0, 0)?.bg, [44, 55, 66]);
  assert.deepEqual(after.getCell(0, 0)?.fg, [201, 202, 203]);
});
