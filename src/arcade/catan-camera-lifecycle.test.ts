import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

test('re-entering Catan resets its camera while starting and restarting matches preserve it', () => {
  const enter = main.slice(main.indexOf('function enterCatanGame()'), main.indexOf('function startCatanGame()'));
  const start = main.slice(main.indexOf('function startCatanGame()'), main.indexOf('function newCatanGame()'));
  const next = main.slice(main.indexOf('function newCatanGame()'), main.indexOf('function buildCatanGameMenu()'));

  assert.ok(enter.includes('catanGameScene.scene.resetView();'));
  assert.ok(enter.indexOf('resetView();') < enter.indexOf('prepareBoard();'));
  assert.equal(start.includes('resetView();'), false);
  assert.equal(next.includes('resetView();'), false);
});
