import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('the site is forced dark and omits the footer theme switcher', async () => {
  const [css, layout, provider] = await Promise.all([
    readFile(new URL('./global.css', import.meta.url), 'utf8'),
    readFile(new URL('./[lang]/layout.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../components/geistdocs/provider.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(css, /\.dark body:has\(\.living-title-page\) header\.sticky/);
  assert.match(css, /\.site-default-footer footer > div:last-child fieldset \{ display: none; \}/);
  assert.match(css, /\.living-title-page \{ background: #000; \}/);
  assert.match(css, /\.living-title__stage \{[^\n]*background: #000;/);
  assert.match(layout, /'antialiased dark'/);
  assert.match(provider, /enableSystem: false, forcedTheme: 'dark'/);
});
