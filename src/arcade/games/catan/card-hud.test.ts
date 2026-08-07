// Scene-level only. The card HUD's presentation (labels, casing, glyphs, widths, which stats
// show) is in fast visual iteration and is deliberately NOT asserted here — those tests break
// every turn and cost more than they catch. Verify the UI with `pnpm snapshot ... board-cards hud`
// and look at the PNG instead.
import assert from 'node:assert/strict';
import test from 'node:test';
import { RenderTarget } from '../../../engine/index.ts';
import { TileScene } from './tile-scene.ts';

test('Board + cards remains a full board scene with projected number tokens', () => {
  const scene = new TileScene();
  scene.setMode('boardCards');
  scene.settle();
  scene.renderScene(new RenderTarget(140, 100), 0.7);
  assert.equal(scene.currentMode(), 'boardCards');
  assert.equal(scene.boardTokens(140, 50).length, 18);
  assert.equal(scene.boardPortLabels(140, 50).length, 9);
});
