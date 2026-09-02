import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('docs use a flat peer-page navigation and Sans typography', async () => {
  const [page, content, css] = await Promise.all([
    readFile(new URL('./[lang]/docs/[[...slug]]/page.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./[lang]/docs/docs-content.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./global.css', import.meta.url), 'utf8'),
  ]);
  for (const label of ['Overview', 'Getting started', 'Package API', 'Engine', 'Rendering pipeline', 'TUI', 'Components', 'Game visuals', 'Rules', 'Game harness', 'Headless tooling', 'Web API', 'Platform', 'Browser host']) assert.match(content, new RegExp(`label: '${label}'`));
  assert.match(page, /const CORE_NAV/);
  assert.match(page, /nestedNavItems/);
  assert.match(page, /drillIn: true/);
  assert.doesNotMatch(page, /<details|<summary/);
  assert.match(css, /\.doc-page-header h1 \{[^\n]*var\(--font-geist-sans\)/);
  assert.match(css, /\.doc-article h2 \{[^\n]*var\(--font-geist-sans\)/);
  assert.doesNotMatch(css, /\.doc-(?:shell|article|sidebar|toc|page-header)[^\n]*font-site-display/);
});

test('guides and reference use real child routes with generated symbol coverage', async () => {
  const [page, reference, generated, script] = await Promise.all([
    readFile(new URL('./[lang]/docs/[[...slug]]/page.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./[lang]/docs/docs-reference.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./[lang]/docs/generated-symbols.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../../scripts/generate-doc-symbols.mjs', import.meta.url), 'utf8'),
  ]);
  for (const slug of ['guides/render-scene', 'guides/terminal-app', 'guides/custom-game', 'guides/visual-testing', 'reference/engine/render-target', 'reference/engine/material', 'reference/engine/surface', 'reference/tui/screen', 'reference/tui/layout-nodes', 'reference/tui/renderer-keymap', 'reference/components/input', 'reference/symbols']) assert.match(reference, new RegExp(slug));
  for (const section of ['Import', 'Signature', 'Lifecycle', 'Example', 'Common failures']) assert.match(reference, new RegExp(`heading: '${section}'`));
  assert.match(page, /Back to all documentation sections/);
  assert.match(page, /IconChevronRight/);
  assert.match(generated, /@vercel\/arcade\/engine/);
  assert.match(generated, /@vercel\/arcade\/tui/);
  assert.match(script, /checker\.getExportsOfModule/);
  assert.match(script, /packageJson\.exports/);
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
  assert.match(content, /<CodeBlock title=\{title\}>/);
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
  for (const heading of ['Start here', 'Choose an API', 'Understand the architecture', 'Choose the right path']) assert.match(content, new RegExp(`heading: '${heading}'`));
  assert.match(content, /npm i -g @vercel\/arcade/);
  assert.match(content, /supported consumer boundary/);
  assert.match(content, /@vercel\/arcade\/harness/);
});

test('getting started covers install, source, sign-in, and supported library paths', async () => {
  const content = await readFile(new URL('./[lang]/docs/docs-content.tsx', import.meta.url), 'utf8');
  for (const heading of ['Install the CLI', 'Run from source', 'Enable model play', 'Use Arcade as a library']) assert.match(content, new RegExp(`heading: '${heading}'`));
  assert.match(content, /arcade --login/);
  assert.match(content, /npm install @vercel\/arcade/);
});

test('the agent corpus preserves the implementation contracts documented for humans', async () => {
  const corpus = await readFile(new URL('../public/llms-full.txt', import.meta.url), 'utf8');
  for (const detail of ['Core contracts for agents', 'Material<U>', 'Screen', 'GameState<Action>', 'MatchScene.playMove()', 'CanvasSurfaceHost']) assert.match(corpus, new RegExp(detail.replace(/[<>()]/g, '\\$&')));
  assert.match(corpus, /Current limitations/);
});
