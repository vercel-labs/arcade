import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BrowserIslandersTileShowcase,
  BrowserChessBoardShowcase,
  BrowserChessPieceShowcase,
  BrowserPokerChipsShowcase,
  createBrowserMiniScene,
} from './browser-mini-scenes.ts';
import type { BrowserMiniScene } from './mini-scene.ts';

function visibleGlyphs(scene: BrowserMiniScene): number {
  const { surface } = scene.frame(48, 28, 0.4);
  let count = 0;
  for (let y = 2; y < surface.rows - 2; y++) {
    for (let x = 0; x < surface.cols; x++) {
      if (surface.getCell(x, y)?.ch !== ' ') count++;
    }
  }
  return count;
}

test('mini-scene factory creates a focused real Chess board', () => {
  const scene = createBrowserMiniScene('chess-board');
  assert.ok(scene instanceof BrowserChessBoardShowcase);
  assert.ok(visibleGlyphs(scene) > 100);
  assert.equal(scene.cycleDisplayMode(), 'pixel');
});

test('Chess mini scene can prepare imported production-style OBJ assets asynchronously', async () => {
  const source = ['v -0.5 0 0', 'v 0.5 0 0', 'v 0 1 0', 'f 1 2 3'].join('\n');
  const scene = createBrowserMiniScene('chess-board', {
    chessPieceAssetBaseUrl: '/models/chess',
    chessPieceFetchText: async () => source,
  });
  await scene.prepare?.();
  assert.ok(visibleGlyphs(scene) > 100);
});

test('Islanders mini scene renders the shared production terrain mesh', () => {
  const scene = createBrowserMiniScene('islanders-fields');
  assert.ok(scene instanceof BrowserIslandersTileShowcase);
  assert.ok(visibleGlyphs(scene) > 40);
  assert.equal(scene.cycleDisplayMode(), 'pixel');
  assert.equal(scene.cycleDisplayMode(), 'hybrid');
  assert.equal(scene.cycleDisplayMode(), 'ascii');
});

test('all production Islanders terrain mini scenes render through one contract', () => {
  for (const terrain of ['fields', 'forest', 'pasture', 'hills', 'mountains', 'desert'] as const) {
    const scene = createBrowserMiniScene(`islanders-${terrain}`);
    assert.ok(scene instanceof BrowserIslandersTileShowcase);
    assert.ok(visibleGlyphs(scene) > 30, terrain);
  }
});

test('Chess piece mini scene prepares the imported production asset', async () => {
  const source = ['v -0.5 0 0', 'v 0.5 0 0', 'v 0 1 0', 'f 1 2 3'].join('\n');
  const scene = createBrowserMiniScene('chess-knight', {
    chessPieceAssetBaseUrl: '/models/chess',
    chessPieceFetchText: async () => source,
  });
  assert.ok(scene instanceof BrowserChessPieceShowcase);
  await scene.prepare?.();
  assert.ok(visibleGlyphs(scene) > 0);
});

test('Poker chip mini scene renders the production starting stack', () => {
  const scene = createBrowserMiniScene('poker-chips');
  assert.ok(scene instanceof BrowserPokerChipsShowcase);
  assert.ok(visibleGlyphs(scene) > 20);
});

test('mini-scene factory rejects unknown JavaScript input with a useful error', () => {
  assert.throws(
    () => createBrowserMiniScene('islanders-volcano' as never),
    /Unknown browser mini scene: islanders-volcano/,
  );
});
