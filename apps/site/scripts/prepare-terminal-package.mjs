import { access, mkdir, readdir, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(siteRoot, '../..');
const outputDirectory = join(siteRoot, 'app/api/terminal/session');
const outputPath = join(outputDirectory, 'arcade-package.tgz');
const stagingDirectory = join(siteRoot, '.terminal-package');
const repositoryCompiler = join(repositoryRoot, 'node_modules/typescript/bin/tsc');

try {
  await access(repositoryCompiler);
} catch {
  console.log('Installing the root package toolchain for the hosted terminal archive...');
  execFileSync(
    'pnpm',
    ['--dir', repositoryRoot, 'install', '--frozen-lockfile', '--ignore-scripts'],
    { stdio: 'inherit' },
  );
}

await rm(stagingDirectory, { recursive: true, force: true });
await mkdir(stagingDirectory, { recursive: true });
await mkdir(outputDirectory, { recursive: true });

execFileSync('pnpm', ['--dir', repositoryRoot, 'pack', '--pack-destination', stagingDirectory], {
  stdio: 'inherit',
});

const archives = (await readdir(stagingDirectory)).filter((name) => name.endsWith('.tgz'));
if (archives.length !== 1) {
  throw new Error(`Expected one Arcade package archive, found ${archives.length}.`);
}

await rm(outputPath, { force: true });
await rename(join(stagingDirectory, archives[0]), outputPath);
await rm(stagingDirectory, { recursive: true, force: true });
console.log(`Prepared hosted terminal package: ${outputPath}`);
