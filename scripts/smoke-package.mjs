import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temp = mkdtempSync(join(tmpdir(), 'arcade-package-smoke-'));
const esbuildPackage = readdirSync(resolve(root, 'node_modules/.pnpm')).find((name) => name.startsWith('esbuild@'));
if (!esbuildPackage) throw new Error('package smoke needs the esbuild installed with tsx');
const esbuild = resolve(root, 'node_modules/.pnpm', esbuildPackage, 'node_modules/esbuild/bin/esbuild');

function linkDependency(name, destinationRoot) {
  const destination = join(destinationRoot, 'node_modules', ...name.split('/'));
  mkdirSync(dirname(destination), { recursive: true });
  symlinkSync(resolve(root, 'node_modules', ...name.split('/')), destination, 'dir');
}

try {
  execFileSync('pnpm', ['pack', '--pack-destination', temp], { cwd: root, stdio: 'pipe' });
  const archive = readdirSync(temp).find((name) => name.endsWith('.tgz'));
  if (!archive) throw new Error('pnpm pack did not create a tarball');
  execFileSync('tar', ['-xzf', join(temp, archive), '-C', temp], { stdio: 'pipe' });

  const packedRoot = join(temp, 'package');
  const packed = JSON.parse(readFileSync(join(packedRoot, 'package.json'), 'utf8'));
  const consumer = join(temp, 'consumer');
  mkdirSync(join(consumer, 'node_modules', '@vercel'), { recursive: true });
  symlinkSync(packedRoot, join(consumer, 'node_modules', '@vercel', 'arcade'), 'dir');
  for (const dependency of Object.keys(packed.dependencies ?? {})) {
    linkDependency(dependency, consumer);
    linkDependency(dependency, packedRoot);
  }
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  writeFileSync(join(consumer, 'smoke.mjs'), `
import assert from 'node:assert/strict';
import { BrowserArcade as RootBrowserArcade, engine as rootEngine, tui as rootTui } from '@vercel/arcade';
import { Surface } from '@vercel/arcade/engine';
import { decodePng } from '@vercel/arcade/engine/png';
import { fetchObjMesh } from '@vercel/arcade/game-visuals';
import { tileMesh } from '@vercel/arcade/game-visuals/catan';
import { CHESS_PIECE_NAMES, parseChessPieceMeshes } from '@vercel/arcade/game-visuals/chess';
import { playerColumns } from '@vercel/arcade/game-visuals/poker';
import { runMatch } from '@vercel/arcade/harness';
import { CommunicationPolicy } from '@vercel/arcade/harness/communication';
import { CHESS_DEFAULT_MAX_PLIES, runHeadlessChessMatch } from '@vercel/arcade/harness/chess';
import { createCatanModelPlayer, runHeadlessCatanMatch } from '@vercel/arcade/harness/catan';
import { STARTING_STACK } from '@vercel/arcade/harness/poker';
import { RECORD_SCHEMA_VERSION } from '@vercel/arcade/harness/records';
import { createInputParser } from '@vercel/arcade/platform';
import { Box, Text } from '@vercel/arcade/tui';
import { CatanState } from '@vercel/arcade/rules/catan';
import { ChessState } from '@vercel/arcade/rules/chess';
import { HoldemState } from '@vercel/arcade/rules/poker';
import { BrowserArcade, BrowserRenderShowcase, BrowserTuiShowcase, createBrowserMiniScene } from '@vercel/arcade/web';

assert.equal(new Surface(3, 2).cols, 3);
assert.equal(typeof decodePng, 'function');
assert.equal(typeof fetchObjMesh, 'function');
assert.equal(typeof runMatch, 'function');
assert.equal(typeof CommunicationPolicy, 'function');
assert.equal(typeof runHeadlessChessMatch, 'function');
assert.equal(CHESS_DEFAULT_MAX_PLIES, 300);
assert.equal(typeof createCatanModelPlayer, 'function');
assert.equal(typeof runHeadlessCatanMatch, 'function');
assert.equal(STARTING_STACK, 1000);
assert.equal(RECORD_SCHEMA_VERSION, 1);
assert.equal(typeof createInputParser, 'function');
assert.equal(Box({}, [Text({ text: 'ok' })]).children.length, 1);
assert.equal(new ChessState().isTerminal(), false);
assert.equal(new CatanState({ numPlayers: 2 }).isTerminal(), false);
assert.equal(new HoldemState({ stacks: [1000, 1000], button: 0, smallBlind: 10, bigBlind: 20 }).isTerminal(), false);
assert.ok(tileMesh('fields').vertices.length > 0);
assert.ok(playerColumns(1000).length > 0);
const triangleObj = 'v -0.5 0 0\\nv 0.5 0 0\\nv 0 1 0\\nf 1 2 3';
assert.equal(parseChessPieceMeshes(Object.fromEntries(CHESS_PIECE_NAMES.map((name) => [name, triangleObj]))).king.indices.length, 3);
assert.equal(new RootBrowserArcade().play('e4'), true);
assert.equal(new rootEngine.Surface(2, 1).cols, 2);
assert.equal(rootTui.Box({}, [rootTui.Text({ text: 'browser safe' })]).children.length, 1);
assert.equal(new BrowserArcade().play('e4'), true);
assert.equal(new BrowserRenderShowcase().frame(48, 26, 0).displayMode, 'ascii');
assert.match(new BrowserTuiShowcase().frame(48, 26).status, /Selected/);
assert.equal(createBrowserMiniScene('catan-fields').frame(48, 28, 0).displayMode, 'ascii');
console.log('packed Arcade subpaths execute in plain Node');
`);
  execFileSync(process.execPath, ['smoke.mjs'], { cwd: consumer, stdio: 'inherit' });

  writeFileSync(join(consumer, 'consumer.ts'), `
import { BrowserArcade } from '@vercel/arcade';
import { runHeadlessChessMatch, type ChessMatchResult } from '@vercel/arcade/harness/chess';
import { ChessState, type Move } from '@vercel/arcade/rules/chess';

const state = new ChessState();
const move: Move = state.legalActions()[0];
const browser = new BrowserArcade();
const runner: typeof runHeadlessChessMatch = runHeadlessChessMatch;
const result: ChessMatchResult | undefined = undefined;
void move; void browser; void runner; void result;
`);
  writeFileSync(join(consumer, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true,
      noEmit: true, skipLibCheck: true,
    },
    include: ['consumer.ts'],
  }, null, 2));
  execFileSync(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'], { cwd: consumer, stdio: 'inherit' });

  writeFileSync(join(consumer, 'browser-entry.mjs'), `
import { BrowserArcade, engine, tui } from '@vercel/arcade';
new BrowserArcade().frame();
new engine.Surface(2, 1);
tui.Box({}, [tui.Text({ text: 'browser safe' })]);
`);
  execFileSync(esbuild, [
    'browser-entry.mjs', '--bundle', '--platform=browser', '--format=esm', '--outfile=browser-bundle.mjs',
  ], { cwd: consumer, stdio: 'inherit' });
  const rootBrowserBundle = readFileSync(join(consumer, 'browser-bundle.mjs'), 'utf8');
  if (/process\.stdout|node:/.test(rootBrowserBundle)) {
    throw new Error('root browser bundle retained a Node-only global or builtin');
  }

  writeFileSync(join(consumer, 'web-browser-entry.mjs'), `
import { BrowserArcade } from '@vercel/arcade/web';
new BrowserArcade().frame();
`);
  execFileSync(esbuild, [
    'web-browser-entry.mjs', '--bundle', '--platform=browser', '--format=esm', '--outfile=web-browser-bundle.mjs',
  ], { cwd: consumer, stdio: 'inherit' });

  const help = execFileSync(process.execPath, [join(packedRoot, 'bin/arcade.mjs'), '--help'], { cwd: consumer, encoding: 'utf8' });
  if (!/arcade/i.test(help)) throw new Error('packed CLI --help did not print Arcade help');
  const version = execFileSync(process.execPath, [join(packedRoot, 'bin/arcade.mjs'), '--version'], { cwd: consumer, encoding: 'utf8' });
  if (version.trim() !== packed.version) throw new Error(`packed CLI --version printed ${JSON.stringify(version.trim())}`);

  for (const subpath of ['.', './engine', './engine/png', './harness', './harness/communication', './harness/chess', './harness/catan', './harness/poker', './harness/records', './platform', './game-visuals', './game-visuals/catan', './game-visuals/chess', './game-visuals/poker', './tui', './rules', './rules/chess', './rules/catan', './rules/poker', './web']) {
    if (!packed.exports?.[subpath]) throw new Error(`packed package is missing export ${subpath}`);
  }
  for (const path of ['dist/public-api.js', 'dist/public-api.d.ts', 'docs/harness.md', 'docs/architecture/package-boundaries.md']) {
    if (!existsSync(join(packedRoot, path))) throw new Error(`packed package is missing ${path}`);
  }
  if (existsSync(join(packedRoot, 'src'))) throw new Error('packed package should not ship raw TypeScript sources');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
