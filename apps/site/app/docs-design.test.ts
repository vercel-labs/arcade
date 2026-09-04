import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('docs navigation is owned by a persistent layout so pane transitions can run', async () => {
  const [layout, shell, page] = await Promise.all([
    readFile(new URL('./[lang]/docs/layout.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./[lang]/docs/docs-shell.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./[lang]/docs/[[...slug]]/page.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(layout, /<DocsShell>\{children\}<\/DocsShell>/);
  assert.match(shell, /usePathname\(\)/);
  assert.match(shell, /<DesktopDocsNav/);
  assert.match(shell, /<MobileDocsNav/);
  assert.doesNotMatch(page, /DesktopDocsNav|MobileDocsNav|className="doc-shell/);
});

test('docs drill-in changes local pane state before navigation and the tablet drawer uses the viewport', async () => {
  const [client, css] = await Promise.all([
    readFile(new URL('./[lang]/docs/docs-client.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./global.css', import.meta.url), 'utf8'),
  ]);
  assert.match(client, /navigationForPathname\(item\.href\)/);
  assert.match(client, /setView\('section'\)/);
  assert.match(client, /requestAnimationFrame\(\(\) => setSectionRevealed\(true\)\)/);
  assert.match(client, /<button aria-label="Back to all documentation sections"/);
  assert.match(css, /header\.sticky\.is-menu-open \{[^\n]*backdrop-filter: none !important;/);
});

test('docs use a task-first grouped navigation and Sans typography', async () => {
  const [page, client, navigation, content, css] = await Promise.all([
    readFile(new URL('./[lang]/docs/[[...slug]]/page.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./[lang]/docs/docs-client.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./[lang]/docs/docs-navigation.ts', import.meta.url), 'utf8'),
    readFile(new URL('./[lang]/docs/docs-content.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./global.css', import.meta.url), 'utf8'),
  ]);
  for (const label of ['Overview', 'Getting started', 'Package API', 'Engine', 'Rendering pipeline', 'Terminal platform', 'Terminal UI', 'Components', 'Game visuals', 'Rules', 'Game harness', 'Agentic tooling', 'Browser integration', 'Hosted CLI']) assert.match(content, new RegExp(`label: '${label}'`));
  assert.match(content, /slug: 'renderer-pipeline'[\s\S]*slug: 'platform'[\s\S]*slug: 'tui'[\s\S]*slug: 'components'/);
  assert.match(content, /@vercel\/geistdocs\/components\/mermaid/);
  assert.match(content, /<Mermaid chart=\{ARCHITECTURE_CHART\}/);
  assert.match(content, /<Mermaid chart=\{MOBILE_ARCHITECTURE_CHART\}/);
  assert.match(content, /subgraph complete\["Arcade architecture"\]/);
  assert.match(content, /subgraph focused\["Browser surfaces"\]/);
  assert.doesNotMatch(content, /Complete Arcade|Focused browser surfaces/);
  assert.doesNotMatch(content, /<Code title="Architecture">/);
  assert.match(content, /npx @vercel\/arcade@latest/);
  assert.match(navigation, /export const ROOT_DOCS_NAV/);
  assert.match(navigation, /href: '\/docs\/app', label: 'Using Arcade', drillIn: true/);
  assert.match(navigation, /href: '\/docs\/games', label: 'Games', drillIn: true/);
  assert.match(navigation, /href: '\/docs\/web', label: 'Browser integration', drillIn: true/);
  assert.match(navigation, /href: '\/docs\/package-api', label: 'Package API'[\s\S]*href: '\/docs\/reference', label: 'API Reference'[\s\S]*href: '\/docs\/motivation', label: 'Motivation'/);
  assert.match(page, /corePage\('engine'\), corePage\('renderer-pipeline'\), corePage\('game-visuals'\)/);
  assert.match(page, /corePage\('platform'\), corePage\('tui'\), corePage\('components'\)/);
  assert.match(navigation, /navigationForPathname/);
  assert.match(navigation, /drillIn: true/);
  assert.match(client, /DesktopDocsNav/);
  assert.match(client, /data-doc-sidebar-pane="root"/);
  assert.match(client, /data-doc-sidebar-pane="section"/);
  assert.match(client, /scrollIntoView\(\{ block: 'nearest' \}\)/);
  assert.match(client, /data-fade-bottom=\{fade\.bottom\}/);
  assert.doesNotMatch(page, /<details|<summary/);
  assert.match(css, /\.doc-page-header h1 \{[^\n]*var\(--font-geist-sans\)/);
  assert.match(css, /\.doc-article h2 \{[^\n]*var\(--font-geist-sans\)/);
  assert.match(css, /\.doc-architecture svg \{[^\n]*var\(--font-geist-sans\)/);
  assert.match(css, /\.doc-architecture \.cluster-label span \{ display: inline-block; transform: translateY\(6px\); \}/);
  assert.match(css, /\.doc-article > section > h2 \{ overflow-wrap: anywhere; \}/);
  assert.match(css, /\.doc-sidebar__pane \{[^\n]*150ms cubic-bezier\(\.175,\.885,\.32,1\.1\)/);
  assert.match(css, /\.doc-sidebar__scroll \{[^\n]*height: calc\(100dvh - 64px\)[^\n]*overflow-y: auto[^\n]*scroll-padding-block: 40px[^\n]*mask-image: linear-gradient/);
  assert.match(css, /\.doc-sidebar__scroll\[data-fade-bottom='true'\] \{ --doc-sidebar-fade-bottom: 40px; \}/);
  assert.match(css, /prefers-reduced-motion: reduce[^\n]*\.doc-sidebar__pane \{ transition: none; \}/);
  assert.doesNotMatch(css, /\.doc-(?:shell|article|sidebar|toc|page-header)[^\n]*font-site-display/);
});

test('Motivation is a paragraph-only Docs letter with a quiet linked signature', async () => {
  const [motivation, about, page, css, sitemap] = await Promise.all([
    readFile(new URL('./[lang]/docs/docs-motivation.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./[lang]/about/page.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./[lang]/docs/[[...slug]]/page.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./global.css', import.meta.url), 'utf8'),
    readFile(new URL('./sitemap.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(motivation, /label: 'Motivation'/);
  assert.match(motivation, /title: 'Why Arcade exists'/);
  assert.match(motivation, /summary: 'A letter from the developer\.'/);
  assert.match(motivation, /I never thought about the terminal as a canvas/);
  assert.match(motivation, /entered a hackathon/);
  assert.match(motivation, /my silly idea resonated with the judges/);
  assert.match(motivation, /a few weeks later, I started my first day at Vercel/);
  assert.match(motivation, /AlphaGo's Move 37 against Lee Sedol in Game 2/);
  assert.match(motivation, /Nen restrictions and binding vows/);
  assert.match(motivation, /tendencies that emerge from the model as it is/);
  assert.match(motivation, /few fun minutes during a busy day/);
  assert.match(motivation, /href="https:\/\/x\.com\/_Brian_Zhang"/);
  assert.match(motivation, /className="doc-letter__signature">- <a/);
  assert.doesNotMatch(motivation, /Notion Developer Platform|ended up winning|When I later joined Vercel/);
  assert.doesNotMatch(motivation, /—|<h2|<ul|<Code/);
  assert.match(about, /redirect\('\/docs\/motivation'\)/);
  assert.match(page, /MOTIVATION_DOC/);
  assert.match(page, /page\.body \?\?/);
  assert.match(css, /\.doc-letter__signature a \{ color: inherit; text-decoration: none; \}/);
  assert.match(css, /\.doc-letter__signature a:hover \{ text-decoration: underline;/);
  assert.match(sitemap, /'\/docs\/motivation'/);
});

test('guides and reference use real child routes with generated symbol coverage', async () => {
  const [page, client, reference, generated, script] = await Promise.all([
    readFile(new URL('./[lang]/docs/[[...slug]]/page.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./[lang]/docs/docs-client.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./[lang]/docs/docs-reference.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./[lang]/docs/generated-symbols.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../../scripts/generate-doc-symbols.mjs', import.meta.url), 'utf8'),
  ]);
  for (const slug of ['guides/render-scene', 'guides/terminal-app', 'guides/custom-game', 'guides/visual-testing', 'reference/engine/render-target', 'reference/engine/material', 'reference/engine/surface', 'reference/tui/screen', 'reference/tui/layout-nodes', 'reference/tui/renderer-keymap', 'reference/components/input', 'reference/symbols']) assert.match(reference, new RegExp(slug));
  for (const section of ['Import', 'Signature', 'Lifecycle', 'Example', 'Common failures']) assert.match(reference, new RegExp(`heading: '${section}'`));
  assert.match(client, /Back to all documentation sections/);
  assert.match(client, /IconChevronRight/);
  assert.match(generated, /@vercel\/arcade\/engine/);
  assert.match(generated, /@vercel\/arcade\/tui/);
  assert.match(script, /checker\.getExportsOfModule/);
  assert.match(script, /packageJson\.exports/);
});

test('games are a drill-in chapter with rules, graphics, model, record, and communication case studies', async () => {
  const [page, navigation, content, games, sitemap, css] = await Promise.all([
    readFile(new URL('./[lang]/docs/[[...slug]]/page.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./[lang]/docs/docs-navigation.ts', import.meta.url), 'utf8'),
    readFile(new URL('./[lang]/docs/docs-content.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./[lang]/docs/docs-games.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./sitemap.ts', import.meta.url), 'utf8'),
    readFile(new URL('./global.css', import.meta.url), 'utf8'),
  ]);
  for (const slug of ['games/chess', 'games/poker', 'games/islanders', 'games/communication']) {
    assert.match(games, new RegExp(`slug: '${slug}'`));
    assert.match(sitemap, new RegExp(`/docs/${slug}`));
  }
  for (const topic of ['Rules at a glance', 'What the model sees', 'What each model sees', 'What an Islanders model sees', 'From OBJ files to terminal pieces', 'A shuffle is a physical timeline', 'The island is generated, not imported', 'Run and record a match', 'Run a tournament and preserve both records', 'Choose how often the table talks', 'Address a model with @', 'Build your own game']) assert.match(games, new RegExp(topic));
  assert.match(page, /GAME_DOCS/);
  assert.match(navigation, /games: \{[\s\S]*title: 'Games'/);
  assert.match(navigation, /href: '\/docs\/rules', label: 'Rules'/);
  assert.match(page, /GAME_SECTION_DOCS/);
  assert.match(page, /RULES_DOC/);
  assert.match(content, /slug: 'rules'[\s\S]*navParent: 'games'[\s\S]*navGroup: 'Shared systems'/);
  assert.match(games, /import Link from 'next\/link'/);
  assert.match(games, /<Link href="\/docs\/games\/chess"/);
  assert.match(games, /<dl className="api-list"/);
  assert.match(games, /<dt>\{name\}<\/dt><dd>\{description\}<\/dd>/);
  assert.doesNotMatch(games, /Build a fourth game/);
  assert.match(games, /Every live Chess, Poker, and Islanders game uses the same composer/);
  assert.match(games, /src\/arcade\/match\/chat-composer\.ts/);
  assert.match(games, /src\/arcade\/match\/directed-replies\.ts/);
  assert.doesNotMatch(games, /currently belongs to live Islanders|src\/arcade\/games\/islanders\/chat-composer\.ts/);
  assert.match(css, /\.doc-cards--games \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); \}/);
});

test('Browser integration groups focused Canvas APIs and the hosted CLI', async () => {
  const [page, navigation, content, corpus] = await Promise.all([
    readFile(new URL('./[lang]/docs/[[...slug]]/page.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./[lang]/docs/docs-navigation.ts', import.meta.url), 'utf8'),
    readFile(new URL('./[lang]/docs/docs-content.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../public/llms-full.txt', import.meta.url), 'utf8'),
  ]);
  assert.match(content, /slug: 'web'[\s\S]*label: 'Browser integration'[\s\S]*heading: 'Choose a browser path'/);
  assert.match(content, /slug: 'browser-host'[\s\S]*label: 'Hosted CLI'[\s\S]*navParent: 'web'/);
  assert.match(page, /BROWSER_DOCS/);
  assert.match(navigation, /web: \{[\s\S]*title: 'Browser integration'/);
  assert.match(navigation, /href: '\/docs\/browser-host', label: 'Hosted CLI'/);
  assert.match(corpus, /Browser integration overview/);
  assert.match(corpus, /Hosted CLI child page/);
});

test('Using Arcade is a player-facing chapter with controls, billing, and recoverable model setup', async () => {
  const [page, navigation, app, sitemap, corpus, tutorial] = await Promise.all([
    readFile(new URL('./[lang]/docs/[[...slug]]/page.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./[lang]/docs/docs-navigation.ts', import.meta.url), 'utf8'),
    readFile(new URL('./[lang]/docs/docs-app.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./sitemap.ts', import.meta.url), 'utf8'),
    readFile(new URL('../public/llms-full.txt', import.meta.url), 'utf8'),
    readFile(new URL('../../../src/arcade/tutorial/chapters.ts', import.meta.url), 'utf8'),
  ]);
  for (const slug of ['app', 'app/controls', 'app/models']) {
    assert.match(app, new RegExp(`slug: '${slug}'`));
    assert.match(sitemap, new RegExp(`/docs/${slug}`));
    assert.match(corpus, new RegExp(`/docs/${slug.replace('/', '\\/')}`));
  }
  for (const topic of ['Choose how to play', 'Follow the app flow', 'Start a match', 'Start with the Tutorial', 'Use global controls', 'Understand the Arcade key', 'Understand the model picker', 'Understand free and paid access', 'Troubleshoot model play']) assert.match(app, new RegExp(`heading: '${topic}'`));
  assert.match(app, /title: 'Navigating the app'/);
  assert.match(app, /Arcade automatically creates an AI Gateway API key for your selected team/);
  assert.match(app, /Arcade \(<username>\)/);
  assert.match(app, /models\?freeTier=true/);
  assert.match(app, /view spend/);
  assert.match(app, /suggests different creators across unfilled seats/);
  assert.match(app, /Exit immediately from any screen/);
  for (const fact of ['availability-aware AI Gateway model catalog', 'Start-time health', 'Signing out of Arcade clears local access only', 'never purchased AI Gateway Credits', 'valid credit card', 'grants $5 in free credits every 30 days', 'at least $10 in AI Gateway Credits', 'recurring $5 free credit no longer applies']) assert.match(app, new RegExp(fact.replace('$', '\\$')));
  for (const url of ['ai-gateway%2Fapi-keys', 'docs/ai-gateway/pricing', 'observability-and-spend/budgets']) assert.match(app, new RegExp(url));
  assert.match(page, /import \{ APP_DOCS \}/);
  assert.match(navigation, /app: \{[\s\S]*title: 'Using Arcade'/);
  assert.match(navigation, /href: '\/docs\/app\/models', label: 'Models and billing'/);
  assert.doesNotMatch(app, /get-or-create exchange|existing exchanged key|Every Vercel team has an AI Gateway free tier and paid tier|instead of hardcoding|card on file/i);
  assert.match(tutorial, /monthly included Gateway credit/);
  assert.doesNotMatch(tutorial, /card on file/i);
});

test('game documentation examples match the public contracts they teach', async () => {
  const games = await readFile(new URL('./[lang]/docs/docs-games.tsx', import.meta.url), 'utf8');
  for (const expected of [
    "fetchChessPieceMeshes('/assets/chess_blender', loadText)",
    'planChessMove(move, layout)',
    'drawMovingPiece(segment.type, position)',
    'hideStaticPiece(segment.hideSq)',
    'stacks: [1000, 1000, 1000]',
    'button: 0',
    'smallBlind: 10',
    'bigBlind: 20',
    'preparePokerCardTextures()',
    "['Ah', 'Ac', 'Kh', 'Qh', 'Jh', '9h', '2h']",
    'must steal one random resource when an eligible adjacent opponent exists',
    'https://www.pokertda.com/poker-tda-rules/',
  ]) assert.match(games, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  for (const stale of ['fetchChessPieceMeshes(loadText)', 'planChessMove(state.board, move)', 'segment.piece', 'plan.hideSq', 'players: 3, startingStack', 'preparePokerCardTextures(loadTexture)', 'www.pokerstars.com/poker/learn/how-to-play']) assert.doesNotMatch(games, new RegExp(stale.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('game docs distinguish plaintext from code and copy every visible structure', async () => {
  const [games, content, reference, code, client] = await Promise.all([
    readFile(new URL('./[lang]/docs/docs-games.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./[lang]/docs/docs-content.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./[lang]/docs/docs-reference.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./[lang]/docs/docs-code.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./[lang]/docs/docs-client.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(games, /language="text" title="Model context \(abridged\)"/);
  assert.match(games, /language="text" title="Prompt state machine"/);
  assert.match(games, /language="text" title="Checklist"/);
  assert.match(content, /language="text" title="Pipeline"/);
  assert.match(reference, /language="text" title="Workflow"/);
  assert.match(code, /data-language=\{lang\}/);
  assert.match(client, /p, li, pre, dt, dd, \.doc-note, \.doc-cards > a, \.source-link/);
  assert.match(client, /node\.tagName === 'DT'/);
  assert.match(client, /node\.classList\.contains\('source-link'\)/);
  assert.match(client, /dataset\.language/);
});

test('the generated public symbol index is current', async () => {
  const { execFileSync } = await import('node:child_process');
  const { resolve } = await import('node:path');
  const root = resolve(new URL('../../..', import.meta.url).pathname);
  const generated = resolve(root, 'apps/site/app/[lang]/docs/generated-symbols.ts');
  const before = await readFile(generated, 'utf8');
  execFileSync(process.execPath, [resolve(root, 'scripts/generate-doc-symbols.mjs')], { cwd: root, stdio: 'ignore' });
  const after = await readFile(generated, 'utf8');
  assert.equal(after, before, 'run pnpm docs:symbols and commit the updated public symbol index');
});

test('reference pages document behavioral contracts rather than only naming exports', async () => {
  const content = await readFile(new URL('./[lang]/docs/docs-content.tsx', import.meta.url), 'utf8');
  for (const heading of ['Own the Screen lifecycle', 'Material contract', 'NoticeToast', 'Implement GameState', 'Implement a Player', 'Canonical records', 'Render a Surface to Canvas', 'Parse input']) assert.match(content, new RegExp(`heading: '${heading}'`));
  for (const contract of ['frameComposited', 'ShapeGlyphSurfaceCache', 'InputOpts', 'chanceOutcomes', 'ModelPlayer', 'CanvasSurfaceHost', 'createInputParser']) assert.match(content, new RegExp(contract));
  for (const detail of ['SelectOpts', 'fixed 0–1 range', 'setHeight\(\)', 'chanceRng', 'forceFull']) assert.match(content, new RegExp(detail));
  assert.match(content, /not currently implemented/);
  assert.doesNotMatch(content, /toFEN\(|screen\.key\(|min: 0, max: 1|Use <code>setValue\(\)<\/code>/);
});

test('docs provide highlighted copyable code, a copy-page action, section links, and pagination', async () => {
  const [page, client, code, content] = await Promise.all([
    readFile(new URL('./[lang]/docs/[[...slug]]/page.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./[lang]/docs/docs-client.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./[lang]/docs/docs-code.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./[lang]/docs/docs-content.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(client, /navigator\.clipboard\.writeText\(code\)/);
  assert.match(code, /geistShikiTheme/);
  assert.match(code, /codeToHtml/);
  assert.match(client, /articleMarkdown\(article\)/);
  assert.match(page, /CopyPageButton/);
  assert.doesNotMatch(page, /On this page|Edit on GitHub|doc-toc/);
  assert.match(page, /aria-label="Documentation pagination"/);
  assert.match(page, /href=\{`#\$\{id\}`\}/);
  assert.match(content, /<CodeBlock language=\{language\} title=\{title\}>/);
});

test('every published package family and agentic workflow has a documentation path', async () => {
  const [content, packageJson] = await Promise.all([
    readFile(new URL('./[lang]/docs/docs-content.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../../package.json', import.meta.url), 'utf8'),
  ]);
  const exportedSubpaths = Object.keys((JSON.parse(packageJson) as { exports: Record<string, unknown> }).exports);
  for (const subpath of exportedSubpaths) {
    const specifier = subpath === '.' ? '@vercel/arcade' : `@vercel/arcade${subpath.slice(1)}`;
    assert.match(content, new RegExp(specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing docs coverage for ${specifier}`);
  }
  for (const subpath of ['/engine/png', '/harness/communication', '/harness/chess', '/harness/islanders', '/harness/poker', '/harness/records', '/game-visuals/chess', '/game-visuals/islanders', '/game-visuals/poker']) assert.match(content, new RegExp(subpath.replaceAll('/', '\\/')));
  for (const concept of ['Why snapshots exist', 'Follow the snapshot pipeline', 'Build a portable snapshot', 'Run exported headless games', 'manifest.json', 'events.jsonl']) assert.match(content, new RegExp(concept));
  assert.match(content, /not exported by <code>@vercel\/arcade\/platform<\/code>/);
  assert.doesNotMatch(content, /--players(?:=|\s)/);
});

test('docs overview teaches a task-first path and supported package boundaries', async () => {
  const content = await readFile(new URL('./[lang]/docs/docs-content.tsx', import.meta.url), 'utf8');
  for (const heading of ['Start here', 'Choose what to build', 'Understand the architecture', 'Explore the documentation']) assert.match(content, new RegExp(`heading: '${heading}'`));
  assert.match(content, /npm i -g @vercel\/arcade/);
  assert.match(content, /supported consumer boundary/);
  assert.match(content, /@vercel\/arcade\/harness/);
});

test('getting started covers install, source, sign-in, and supported library paths', async () => {
  const content = await readFile(new URL('./[lang]/docs/docs-content.tsx', import.meta.url), 'utf8');
  for (const heading of ['Before you start', 'Install the CLI', 'Run from source', 'Enable model play', 'Play your first game', 'Use Arcade as a library']) assert.match(content, new RegExp(`heading: '${heading}'`));
  assert.match(content, /arcade --login/);
  assert.match(content, /href="\/docs\/app"/);
  assert.match(content, /npm install @vercel\/arcade/);
});

test('the agent corpus preserves the implementation contracts documented for humans', async () => {
  const corpus = await readFile(new URL('../public/llms-full.txt', import.meta.url), 'utf8');
  for (const detail of ['Core contracts for agents', 'Material<U>', 'Screen', 'GameState<Action>', 'MatchScene.playMove()', 'CanvasSurfaceHost']) assert.match(corpus, new RegExp(detail.replace(/[<>()]/g, '\\$&')));
  for (const detail of ['/docs/app', '/docs/app/controls', '/docs/app/models', '/docs/games', 'Chess case study', 'Poker case study', 'Islanders case study', 'Communication and chat', 'ambient', 'autoreply', '@model', 'runHeadlessChessMatch', 'runPokerSession', 'play and whimsy']) assert.match(corpus, new RegExp(detail.replace(/[<>()]/g, '\\$&')));
  assert.match(corpus, /Current limitations/);
  assert.match(corpus, /Live Chess, Poker, and Islanders games share a human chat composer/);
});

test('every linked documentation source exists in the repository', async () => {
  const sources = await Promise.all([
    './[lang]/docs/docs-content.tsx',
    './[lang]/docs/docs-games.tsx',
    './[lang]/docs/docs-reference.tsx',
  ].map((path) => readFile(new URL(path, import.meta.url), 'utf8')));
  const paths = sources.flatMap((source) => [...source.matchAll(/<Source path="([^"]+)"/g)].map((match) => match[1]!));
  assert.ok(paths.length > 0);
  for (const path of paths) await access(new URL(`../../../${path}`, import.meta.url));
});
