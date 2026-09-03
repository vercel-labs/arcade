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
  assert.match(css, /\.site-nav__inner \{ max-width: none; padding-inline: var\(--arcade-shell-gutter\); \}/);
  assert.match(css, /body:has\(\.living-title-page\) header\.sticky \{[^\n]*background-color: transparent;[^\n]*backdrop-filter: none;[^\n]*transition: background-color 200ms ease;/);
  assert.doesNotMatch(css, /body:has\(\.living-title-page\) header\.sticky \{[^\n]*blur\(/);
  assert.match(css, /\.dark body:has\(\.living-title-page\) header\.sticky\.is-over-footer \{[^\n]*background-color: #000;/);
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
  assert.match(nav, /pathname\.includes\('\/docs'\).*'text-gray-1000' : 'text-gray-900'/);
  assert.match(nav, /site-nav__link site-nav__github text-gray-900/);
  assert.match(css, /header\.sticky \.site-nav__link:hover,[\s\S]*header\.sticky \.site-nav__link:focus-visible \{ color: #fff; \}/);
  assert.match(css, /\.site-nav__link:focus-visible \{ outline: 1px solid currentColor;/);
  assert.doesNotMatch(hero, /Docs ↗|href="\/docs"/);
  assert.doesNotMatch(css, /site-default-footer[^\n]*border-top/);
  assert.doesNotMatch(sitemap, /\/examples/);
  assert.match(nextConfig, /source: '\/examples', destination: '\/', permanent: true/);
  assert.match(nextConfig, /source: '\/docs\/examples', destination: '\/docs\/renderer-pipeline', permanent: true/);
  assert.match(hero, /id="system" style=\{\{ top: '0' \}\}/);
  for (const [id, boundary] of [['chess', '.2105263158'], ['poker', '.4473684211'], ['islanders', '.7368421053']]) {
    assert.match(hero, new RegExp(`id="${id}" style=\\{\\{ top: 'calc\\(\\(100% - var\\(--arcade-viewport-height\\)\\) \\* \\${boundary} \\+ 1px\\)' \\}\\}`));
    const rootHeight = 8_640;
    const viewportHeight = 720;
    const anchorTop = (rootHeight - viewportHeight) * Number(boundary);
    assert.equal(anchorTop / (rootHeight - viewportHeight), Number(boundary));
  }
});

test('mobile navigation preserves every desktop destination in an accessible sheet', async () => {
  const [css, nav] = await Promise.all([
    readFile(new URL('./global.css', import.meta.url), 'utf8'),
    readFile(new URL('../components/site-nav.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(nav, /aria-controls="site-mobile-menu"/);
  assert.match(nav, /aria-expanded=\{open\}/);
  assert.match(nav, /aria-label=\{open \? 'Close menu' : 'Open menu'\}/);
  assert.match(nav, /id="site-mobile-menu"/);
  assert.match(nav, /'Docs'[\s\S]*'AI Gateway'[\s\S]*'GitHub'/);
  assert.match(nav, /event\.key !== 'Escape'/);
  assert.match(nav, /document\.body\.style\.overflow = 'hidden'/);
  assert.match(nav, /window\.matchMedia\('\(min-width: 761px\)'\)/);
  assert.match(css, /@media \(max-width: 760px\) \{[\s\S]*\.site-nav__desktop \{ display: none; \}/);
  assert.match(css, /\.site-nav__menu-toggle \{[^\n]*width: 32px;[^\n]*height: 32px;/);
  assert.match(css, /\.site-nav__mobile-sheet\.is-open \{ opacity: 1; transform: translateY\(0\); pointer-events: auto; \}/);
});

test('AI Gateway opens externally while Docs stays in the current tab', async () => {
  const nav = await readFile(new URL('../components/site-nav.tsx', import.meta.url), 'utf8');
  assert.match(nav, /target=\{link\.external \? '_blank' : undefined\}/);
  assert.match(nav, /rel=\{link\.external \? 'noopener noreferrer' : undefined\}/);
  assert.match(nav, /\{ label: 'Docs', href: '\/docs', external: false \}/);
  assert.match(nav, /\{ label: 'AI Gateway'.*external: true \}/);
  assert.match(nav, /pathname\.includes\('\/docs'\).*text-gray-1000/);
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
  assert.match(css, /\.living-title__primary \{[^\n]*height: 44px/);
  assert.match(css, /\.living-title__primary \{[^\n]*border-radius: 999px/);
  assert.doesNotMatch(css, /\.living-title__primary:hover[^\n]*transform/);
  assert.match(css, /\.living-title__install-command \{[^\n]*height: 44px/);
  assert.match(css, /\.living-title__install-command \{[^\n]*border-radius: 999px/);
  assert.match(css, /\.living-title__install-command \{[^\n]*width: max-content/);
  assert.doesNotMatch(css, /install-command:hover \.living-title__install-icon[^\n]*background/);
});

test('the opening hero leads with the agent engine proposition in Geist Pixel', async () => {
  const [css, hero] = await Promise.all([
    readFile(new URL('./global.css', import.meta.url), 'utf8'),
    readFile(new URL('./[lang]/(home)/components/hero.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(hero, /title: \['The 3D game engine', 'built for agents\.'\]/);
  assert.match(hero, /body: \['ASCII in your terminal, no GPU\.', 'Humans can play too\.'\]/);
  assert.match(hero, /title\.map\(\(line\) => <span/);
  assert.match(hero, /body\.map\(\(line\) => <span/);
  assert.match(css, /\.living-title__chapter h1[^\n]*var\(--font-site-display\)/);
  assert.match(css, /\.living-title__chapter p[^\n]*var\(--font-geist-sans\)/);
  assert.match(css, /\.living-title__chapter h1[^\n]*text-shadow: 0 1px 2px #000, 0 0 14px/);
  assert.match(css, /\.living-title__chapter p[^\n]*text-shadow: 0 1px 2px #000, 0 0 12px/);
  assert.match(css, /\.living-title__tour[^\n]*background: rgb\(0 0 0 \/ 34%\)[^\n]*backdrop-filter: blur\(10px\)/);
  assert.match(css, /\.site-nav__inner > a, \.site-nav__desktop[^\n]*drop-shadow\(0 0 10px rgb\(0 0 0 \/ 96%\)\)/);
  assert.match(css, /\.living-title__chapter h1[^\n]*clamp\(44px, 4vw, 56px\)\/\.96/);
  assert.match(css, /\.living-title__chapter p[^\n]*80%[^\n]*18px\/1\.5/);
  assert.match(css, /\.living-title__chapter h1 span, \.living-title__chapter p span[^\n]*white-space: nowrap/);
  assert.match(css, /\.living-title__chapter p \{ max-width: 100%; font-size: clamp\(13px, 4vw, 16px\); line-height: 1\.5; \}/);
  assert.match(css, /\.living-title__install-command code[^\n]*var\(--font-geist-mono\)/);
  assert.match(css, /body:has\(\.living-title-page\) \.site-wordmark[^\n]*var\(--font-site-display\)/);
});

test('the cinematic chapters explain Gateway, the harness, model behavior, and play', async () => {
  const hero = await readFile(new URL('./[lang]/(home)/components/hero.tsx', import.meta.url), 'utf8');
  assert.match(hero, /title: \['Powered by', 'Vercel AI Gateway\.'\]/);
  assert.match(hero, /body: \['Watch hundreds of models face off,', 'or challenge them yourself\.'\]/);
  assert.match(hero, /title: \['Different minds\.', 'Endless possibilities\.'\]/);
  assert.match(hero, /body: \['Everything you see is open source\.', 'Have an idea\? Your move\.'\]/);
  assert.match(hero, /title: \['Every player', 'has a tell\.'\]/);
  assert.match(hero, /body: \['Discover the hidden tendencies', 'of your favorite models\.'\]/);
  assert.match(hero, /title: \['Settle in,', 'have some fun!'\]/);
  assert.match(hero, /body: \['Play a few rounds while waiting for', 'your coding agents to finish\.'\]/);
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

test('the cinematic tour starts only after an explicit user request', async () => {
  const hero = await readFile(new URL('./[lang]/(home)/components/hero.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(hero, /AUTO_START_DELAY_MS|autoStartHandle/);
  assert.doesNotMatch(hero, /setTimeout\([^)]*onTourRequest/);
  assert.match(hero, /onClick=\{\(\) => rootRef\.current\?\.dispatchEvent\(new Event\('arcade-tour-request'\)\)\}/);
  assert.match(hero, /'Start auto-scroll'/);
  assert.match(hero, /'Pause auto-scroll'/);
  assert.doesNotMatch(hero, /Replay|Resume|resetPlayback/);
});

test('auto-scroll keeps a monotonic film clock while the mobile terminal gains visible rows', async () => {
  const hero = await readFile(new URL('./[lang]/(home)/components/hero.tsx', import.meta.url), 'utf8');
  assert.match(hero, /let tourProgress = progressRef\.current/);
  assert.match(hero, /tourProgress = advanceAutoTourProgress\(tourProgress, elapsed\)/);
  assert.match(hero, /progressRef\.current = tourProgress/);
  assert.doesNotMatch(hero, /advanceAutoTourProgress\(progressRef\.current, elapsed\)/);
  assert.match(hero, /const \{ cols, rows \} = responsiveTerminalGrid\([\s\S]*rect\.width,[\s\S]*rect\.height,[\s\S]*MOBILE_CINEMATIC_CELL_HEIGHT/);
  assert.doesNotMatch(hero, /tourGrid/);
});

test('orientation changes resize the responsive canvas without retaining portrait inline dimensions', async () => {
  const hero = await readFile(new URL('./[lang]/(home)/components/hero.tsx', import.meta.url), 'utf8');
  assert.match(hero, /manageCssSize: false/);
  assert.match(hero, /new ResizeObserver\(fitViewport\)/);
  assert.match(hero, /window\.addEventListener\('orientationchange', fitViewport\)/);
  assert.match(hero, /window\.visualViewport\?\.addEventListener\('resize', fitViewport\)/);
  assert.match(hero, /viewportObserver\.disconnect\(\)/);
  assert.doesNotMatch(hero, /canvas\.style\.(?:width|height)\s*=/);
});

test('coarse-pointer mobile canvases use denser ASCII cells without changing UI typography', async () => {
  const hero = await readFile(new URL('./[lang]/(home)/components/hero.tsx', import.meta.url), 'utf8');
  assert.match(hero, /MOBILE_CINEMATIC_CELL_HEIGHT/);
  assert.match(hero, /window\.matchMedia\('\(pointer: coarse\)'\)/);
  assert.match(hero, /coarsePointer\.matches \? MOBILE_CINEMATIC_CELL_HEIGHT : undefined/);
  assert.match(hero, /coarsePointer\.addEventListener\('change', fitViewport\)/);
});

test('the progress-ring tour control is responsive and tracks real scroll progress', async () => {
  const [css, hero] = await Promise.all([
    readFile(new URL('./global.css', import.meta.url), 'utf8'),
    readFile(new URL('./[lang]/(home)/components/hero.tsx', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(css, /living-title__tour::before|living-title__tour::after/);
  assert.doesNotMatch(hero, /tourPrototype|URLSearchParams\(window\.location\.search\).*tourPrototype/);
  assert.match(css, /\.living-title \{ --tour-progress: 0;/);
  assert.match(hero, /root\.style\.setProperty\('--tour-progress'/);
  assert.match(hero, /pathLength="100" r="21"/);
  assert.match(css, /\.living-title__tour-ring-value[^{]*\{[^}]*stroke-dashoffset: calc\(100 \* \(1 - var\(--tour-progress\)\)\)/);
  assert.match(css, /\.living-title__tour \{[^}]*width: 44px;[^}]*height: 44px;[^}]*background: rgb\(0 0 0 \/ 34%\);[^}]*backdrop-filter: blur\(10px\)/);
  assert.match(hero, /className="living-title__tour-media(?: is-play)?" viewBox="0 0 16 16"/);
  assert.match(hero, /className="living-title__tour-mobile"/);
  assert.match(hero, /className="living-title__tour-desktop"/);
  assert.match(css, /\.living-title__tour-mobile \{ display: none; \}/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.living-title__actions \{[^}]*gap: 8px;[^}]*flex-wrap: nowrap;[^}]*\}/);
  assert.match(css, /\.living-title__primary > span \{ display: none; \}/);
  assert.match(css, /\.living-title__install-command \{[^}]*min-width: 0;[^}]*flex: 1 1 auto;/);
  assert.match(css, /\.living-title__tour-mobile \{[^}]*width: 44px;[^}]*flex: 0 0 44px;/);
  assert.doesNotMatch(css, /living-title__tour-mouse|arcade-scroll-cue/);
});

test('cinematic subtitles retain hierarchy while staying legible over ASCII', async () => {
  const css = await readFile(new URL('./global.css', import.meta.url), 'utf8');
  assert.match(css, /\.living-title__chapter p \{[^}]*color: rgb\(255 255 255 \/ 80%\);[^}]*text-shadow: 0 1px 2px #000, 0 0 12px rgb\(0 0 0 \/ 96%\)/);
});

test('the transparent cinematic header gains an opaque surface at the footer boundary', async () => {
  const hero = await readFile(new URL('./[lang]/(home)/components/hero.tsx', import.meta.url), 'utf8');
  assert.match(hero, /footer\.getBoundingClientRect\(\)\.top <= viewportHeight\(\)/);
  assert.doesNotMatch(hero, /footerObserver/);
  assert.match(hero, /header\?\.classList\.remove\('is-over-footer'\)/);
});

test('hero geometry follows the currently available viewport without hydration resizing', async () => {
  const [hero, page] = await Promise.all([
    readFile(new URL('./[lang]/(home)/components/hero.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./[lang]/(home)/page.tsx', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(page, /viewportBootstrap|--arcade-visual-height/);
  assert.doesNotMatch(hero, /useLayoutEffect|--arcade-visual-height|canvas\.style\.(?:width|height)\s*=/);
  assert.match(hero, /const viewportHeight = \(\) => canvas\.parentElement\?\.clientHeight \|\| window\.innerHeight/);
  const css = await readFile(new URL('./global.css', import.meta.url), 'utf8');
  assert.match(css, /--arcade-viewport-height: 100dvh/);
  assert.doesNotMatch(css, /100lvh|100svh/);
  assert.match(css, /\.living-title__stage \{[^\n]*height: var\(--arcade-viewport-height\)/);
});

test('the initial title is server-visible without an entrance animation', async () => {
  const [hero, css] = await Promise.all([
    readFile(new URL('./[lang]/(home)/components/hero.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./global.css', import.meta.url), 'utf8'),
  ]);
  assert.match(hero, /chapter === 0 \? 'is-initial' : ''/);
  assert.doesNotMatch(hero, /living-title__first-frame|has-painted-canvas/);
  assert.match(css, /\.living-title__chapter\.is-initial \{ animation: none; \}/);
});

test('the expensive cinematic renderer pauses after its section leaves the viewport', async () => {
  const hero = await readFile(new URL('./[lang]/(home)/components/hero.tsx', import.meta.url), 'utf8');
  assert.match(hero, /document\.hidden \|\| !cinematicVisible/);
  assert.match(hero, /cinematicObserver\.observe\(root\)/);
  assert.match(hero, /cinematicObserver\.disconnect\(\)/);
});
