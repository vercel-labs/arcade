import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { visibleViewportHeight } from './hero-viewport.ts';

test('hero sizing follows the currently visible mobile viewport', () => {
  assert.equal(visibleViewportHeight(659, 844), 659, 'expanded browser chrome uses the shorter visual viewport');
  assert.equal(visibleViewportHeight(763, 844), 763, 'collapsed browser chrome exposes the added height');
});

test('hero sizing falls back to the layout viewport without VisualViewport', () => {
  assert.equal(visibleViewportHeight(undefined, 844), 844);
  assert.equal(visibleViewportHeight(0, 844), 844);
});

test('hero stage and resize wiring track dynamic mobile browser chrome', async () => {
  const [hero, css] = await Promise.all([
    readFile(new URL('./hero.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../../global.css', import.meta.url), 'utf8'),
  ]);
  assert.match(css, /height: var\(--arcade-visual-height, 100dvh\)/);
  assert.doesNotMatch(css, /living-title__stage[^\n]*100svh/);
  assert.match(hero, /visualViewport\?\.addEventListener\('resize', fitVisibleViewport\)/);
  assert.match(hero, /visualViewport\?\.addEventListener\('scroll', fitVisibleViewport\)/);
  assert.match(hero, /canvas\.style\.height = `\$\{nextHeight\}px`/);
});
