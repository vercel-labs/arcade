import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BrowserRenderShowcase, BrowserTuiShowcase } from './browser-showcase.ts';

test('browser renderer showcase uses every production display mode', () => {
  const showcase = new BrowserRenderShowcase();
  const frame = showcase.frame(48, 26, 0);
  assert.equal(frame.displayMode, 'ascii');
  let sceneGlyphs = 0;
  for (let y = 3; y < frame.surface.rows - 3; y++) {
    for (let x = 0; x < frame.surface.cols; x++) {
      if (frame.surface.getCell(x, y)?.ch !== ' ') sceneGlyphs++;
    }
  }
  assert.ok(sceneGlyphs > 10, 'the engine specimen should remain visibly rendered');
  assert.equal(showcase.cycleDisplayMode(), 'pixel');
  assert.equal(showcase.cycleDisplayMode(), 'hybrid');
  assert.equal(showcase.cycleDisplayMode(), 'ascii');
});

test('browser TUI showcase renders a retained component tree into Surface', () => {
  const showcase = new BrowserTuiShowcase();
  const first = showcase.frame(58, 28);
  assert.match(first.status, /grok-4\.1-fast/);
  assert.ok(first.surface.getCell(3, 2)?.opaque);
  showcase.nextPlayer();
  assert.match(showcase.frame(58, 28).status, /claude-haiku-4\.5/);
});
