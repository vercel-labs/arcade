import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temp = mkdtempSync(join(tmpdir(), 'arcade-package-smoke-'));

try {
  execFileSync('pnpm', ['pack', '--pack-destination', temp], { cwd: root, stdio: 'pipe' });
  const archive = readdirSync(temp).find((name) => name.endsWith('.tgz'));
  if (!archive) throw new Error('pnpm pack did not create a tarball');
  execFileSync('tar', ['-xzf', join(temp, archive), '-C', temp], { stdio: 'pipe' });

  const consumer = join(temp, 'consumer');
  mkdirSync(join(consumer, 'node_modules', '@vercel'), { recursive: true });
  symlinkSync(join(temp, 'package'), join(consumer, 'node_modules', '@vercel', 'arcade'), 'dir');
  symlinkSync(resolve(root, 'node_modules', 'tsx'), join(consumer, 'node_modules', 'tsx'), 'dir');
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  writeFileSync(join(consumer, 'smoke.mjs'), `
import assert from 'node:assert/strict';
import { Surface } from '@vercel/arcade/engine';
import { decodePng } from '@vercel/arcade/engine/png';
import { tileMesh } from '@vercel/arcade/game-visuals/catan';
import { Box, Text } from '@vercel/arcade/tui';
import { ChessState } from '@vercel/arcade/rules/chess';
import { BrowserArcade, BrowserRenderShowcase, BrowserTuiShowcase, createBrowserMiniScene } from '@vercel/arcade/web';

assert.equal(new Surface(3, 2).cols, 3);
assert.equal(typeof decodePng, 'function');
assert.equal(Box({}, [Text({ text: 'ok' })]).children.length, 1);
assert.equal(new ChessState().isTerminal(), false);
assert.ok(tileMesh('fields').vertices.length > 0);
assert.equal(new BrowserArcade().play('e4'), true);
assert.equal(new BrowserRenderShowcase().frame(48, 26, 0).displayMode, 'ascii');
assert.match(new BrowserTuiShowcase().frame(48, 26).status, /Selected/);
assert.equal(createBrowserMiniScene('catan-fields').frame(48, 28, 0).displayMode, 'ascii');
console.log('packed Arcade subpaths import successfully');
`);
  execFileSync(process.execPath, ['--import', 'tsx', 'smoke.mjs'], { cwd: consumer, stdio: 'inherit' });

  const packed = JSON.parse(readFileSync(join(temp, 'package', 'package.json'), 'utf8'));
  for (const subpath of ['.', './engine', './engine/png', './game-visuals/catan', './tui', './rules', './rules/chess', './web']) {
    if (!packed.exports?.[subpath]) throw new Error(`packed package is missing export ${subpath}`);
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}
