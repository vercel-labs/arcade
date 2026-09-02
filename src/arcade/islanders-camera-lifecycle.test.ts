import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

test('re-entering Islanders resets its camera while starting and restarting matches preserve it', () => {
  const enter = main.slice(main.indexOf('function enterIslandersGame()'), main.indexOf('function startIslandersGame()'));
  const start = main.slice(main.indexOf('function startIslandersGame()'), main.indexOf('function newIslandersGame()'));
  const next = main.slice(main.indexOf('function newIslandersGame()'), main.indexOf('function buildIslandersGameMenu()'));

  assert.ok(enter.includes('islandersGameScene.scene.resetView();'));
  assert.ok(enter.indexOf('resetView();') < enter.indexOf('prepareBoard();'));
  assert.equal(start.includes('resetView();'), false);
  assert.equal(next.includes('resetView();'), false);
});
