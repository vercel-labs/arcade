import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Surface } from '../../engine/surface.ts';
import { TimedInkTransition } from './timed-ink-transition.ts';

const CUT = { from: { x: 0.62, y: 0.43 }, to: { x: 0.5, y: 0.5 }, direction: { x: -0.82, y: 0.57 } };

test('timed ink controller starts at the source and completes exactly once', () => {
  const transition = new TimedInkTransition({ duration: 1.2, cut: CUT });
  const from = solid('P');
  const to = solid('C');
  transition.start();
  assert.equal(transition.compose(from, to).getCell(5, 5)?.ch, 'P');
  assert.equal(transition.step(0.6), false);
  assert.ok(transition.progress() > 0 && transition.progress() < 1);
  assert.equal(transition.step(0.6), true);
  assert.equal(transition.compose(from, to).getCell(5, 5)?.ch, 'C');
  transition.cancel();
  assert.equal(transition.active(), false);
});

function solid(glyph: string): Surface {
  const surface = new Surface(10, 10);
  surface.fillRect(0, 0, 10, 10, [0, 0, 0]);
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) surface.setCell(x, y, glyph, [220, 220, 220], [0, 0, 0]);
  return surface;
}
