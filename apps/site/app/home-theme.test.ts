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
  assert.match(css, /--arcade-shell-gutter: clamp\(24px, 4vw, 96px\)/);
  assert.match(css, /body:has\(\.living-title-page\) \.site-nav__inner \{ max-width: none;/);
  assert.match(css, /body:has\(\.living-title-page\) header\.sticky \{[^\n]*background: transparent;[^\n]*backdrop-filter: none;/);
  assert.doesNotMatch(css, /body:has\(\.living-title-page\) header\.sticky \{[^\n]*blur\(/);
  assert.match(layout, /'antialiased dark'/);
  assert.match(provider, /enableSystem: false, forcedTheme: 'dark'/);
});

test('the living title uses borderless chrome and no duplicate examples or docs CTA', async () => {
  const [css, nav, hero, sitemap, nextConfig] = await Promise.all([
    readFile(new URL('./global.css', import.meta.url), 'utf8'),
    readFile(new URL('../components/site-nav.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./[lang]/(home)/components/hero.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./sitemap.ts', import.meta.url), 'utf8'),
    readFile(new URL('../next.config.ts', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(nav, /border-b|Examples|\/examples/);
  assert.match(nav, /'Docs'/);
  assert.match(nav, /'AI Gateway'/);
  assert.doesNotMatch(nav, /QuickTerminalButton|Open Arcade terminal|IconDisplaySmall|>Play<|site-terminal-trigger__label/);
  assert.doesNotMatch(hero, /Docs ↗|href="\/docs"/);
  assert.doesNotMatch(css, /site-default-footer[^\n]*border-top/);
  assert.doesNotMatch(sitemap, /\/examples/);
  assert.match(nextConfig, /source: '\/examples', destination: '\/', permanent: true/);
  assert.match(nextConfig, /source: '\/docs\/examples', destination: '\/docs\/renderer-pipeline', permanent: true/);
  assert.match(hero, /id="system" style=\{\{ top: '0' \}\}/);
  for (const [id, boundary] of [['chess', '.25'], ['poker', '.52'], ['islanders', '.76']]) {
    assert.match(hero, new RegExp(`id="${id}" style=\\{\\{ top: 'calc\\(\\(100% - var\\(--arcade-visual-height, 100dvh\\)\\) \\* \\${boundary} \\+ 1px\\)' \\}\\}`));
    const rootHeight = 8_640;
    const viewportHeight = 720;
    const anchorTop = (rootHeight - viewportHeight) * Number(boundary);
    assert.equal(anchorTop / (rootHeight - viewportHeight), Number(boundary));
  }
});

test('the hero advertises one canonical npm command with a full-row copy target', async () => {
  const [css, hero] = await Promise.all([
    readFile(new URL('./global.css', import.meta.url), 'utf8'),
    readFile(new URL('./[lang]/(home)/components/hero.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(hero, /InstallCommand/);
  assert.doesNotMatch(hero, /InstallTabs|curl -fsSL/);
  assert.match(css, /\.living-title__install-command/);
  const command = await readFile(new URL('./[lang]/(home)/components/install-command.tsx', import.meta.url), 'utf8');
  assert.match(command, /@vercel\/geistdocs\/assets\/icons\/icon-copy/);
  assert.match(command, /@vercel\/geistdocs\/assets\/icons\/icon-check/);
  assert.match(command, /navigator\.clipboard\.writeText\(INSTALL_COMMAND\)/);
  assert.doesNotMatch(command, /CodeBlock|CommandPrompt|data-install-command-rule|curl/);
  assert.match(css, /\.living-title__primary \{[^\n]*height: 40px/);
  assert.doesNotMatch(css, /\.living-title__primary:hover[^\n]*transform/);
  assert.match(css, /\.living-title__install-command \{[^\n]*height: 40px/);
  assert.match(css, /\.living-title__install-command \{[^\n]*width: max-content/);
  assert.doesNotMatch(css, /install-command:hover \.living-title__install-icon[^\n]*background/);
});

test('the opening hero leads with the agent engine proposition in Geist Pixel', async () => {
  const [css, hero] = await Promise.all([
    readFile(new URL('./global.css', import.meta.url), 'utf8'),
    readFile(new URL('./[lang]/(home)/components/hero.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(hero, /The 3D game engine for agents\./);
  assert.match(hero, /ASCII in your terminal\. No GPU\.\\nHumans can play too\./);
  assert.match(css, /\.living-title__chapter h1[^\n]*var\(--font-site-display\)/);
  assert.match(css, /\.living-title__chapter p[^\n]*white-space: pre-line[^\n]*var\(--font-geist-sans\)/);
  assert.match(css, /\.living-title__chapter h1[^\n]*clamp\(44px, 4vw, 56px\)\/\.96/);
  assert.match(css, /\.living-title__chapter p[^\n]*68%[^\n]*18px\/1\.5/);
  assert.match(css, /\.living-title__chapter p \{ max-width: 340px; font-size: 16px; line-height: 1\.5; \}/);
  assert.match(css, /\.living-title__install-command code[^\n]*var\(--font-geist-mono\)/);
  assert.match(css, /body:has\(\.living-title-page\) \.site-wordmark[^\n]*var\(--font-site-display\)/);
});

test('the cinematic chapters explain Gateway, the harness, model behavior, and play', async () => {
  const hero = await readFile(new URL('./[lang]/(home)/components/hero.tsx', import.meta.url), 'utf8');
  assert.match(hero, /Powered by Vercel’s AI Gateway\./);
  assert.match(hero, /Watch hundreds of models face off, or challenge them yourself\./);
  assert.match(hero, /Different minds\. Endless possibilities\./);
  assert.match(hero, /Everything you see is open source\. Your move\./);
  assert.match(hero, /Every player has a tell\./);
  assert.match(hero, /Discover the hidden tendencies of your favorite models\./);
  assert.match(hero, /Settle in, have some fun!/);
  assert.match(hero, /Play a few rounds while coding agents do your work\./);
});

test('the pointer effect is discovered through click and drag without a settings control', async () => {
  const [css, hero] = await Promise.all([
    readFile(new URL('./global.css', import.meta.url), 'utf8'),
    readFile(new URL('./[lang]/(home)/components/hero.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(hero, /canvas\.addEventListener\('pointerdown', onPointerDown\)/);
  assert.match(hero, /pointerField\.beginStroke\(pointerRef\.current\)/);
  assert.match(hero, /pointerField\.setInput\(pointerRef\.current\)/);
  assert.match(hero, /!dragged\) pointerField\.burst/);
  assert.doesNotMatch(hero, /arcade-pointer-mode|living-title__pointer-modes|\['trail', 'off'\]/);
  assert.doesNotMatch(css, /living-title__pointer-modes/);
});
