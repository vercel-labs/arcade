import assert from 'node:assert/strict';
import test from 'node:test';
import { Box, Text } from './nodes.ts';
import { Screen } from './screen.ts';

const WHITE: [number, number, number] = [255, 255, 255];
const BLACK: [number, number, number] = [0, 0, 0];

test('foreground scene content paints above ordinary UI and below portal overlays', () => {
  const screen = new Screen(2, 1);
  const portal = Text({ text: 'T', style: { position: 'absolute', left: 0, top: 0 } });
  portal.overlay = true;
  screen.setRoot(Box({ width: 2, height: 1 }, [Text({ text: 'AA' }), portal]), { x: 0, y: 0, w: 2, h: 1 });

  const surface = screen.snapshot(
    (surf) => surf.fillRect(0, 0, 2, 1, BLACK),
    (surf) => {
      surf.setCell(0, 0, 'F', WHITE, BLACK);
      surf.setCell(1, 0, 'F', WHITE, BLACK);
    },
  );

  assert.equal(surface.getCell(0, 0)?.ch, 'T', 'portal chrome stays above the foreground scene');
  assert.equal(surface.getCell(1, 0)?.ch, 'F', 'foreground scene covers ordinary projected UI');
});
