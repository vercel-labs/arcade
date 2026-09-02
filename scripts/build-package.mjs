#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const tsc = resolve(root, 'node_modules/typescript/bin/tsc');

rmSync(dist, { recursive: true, force: true });
execFileSync(process.execPath, [tsc, '-p', resolve(root, 'tsconfig.build.json')], {
  cwd: root,
  stdio: 'inherit',
});
