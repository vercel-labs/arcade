import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { resolve } from 'node:path';

test('curl installer enforces the published package Node minimum', () => {
  const root = process.cwd();
  const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
    engines?: { node?: string };
  };
  const minimum = packageJson.engines?.node?.match(/>=\s*(\d+)/)?.[1];
  assert.ok(minimum, 'package.json must declare a simple minimum Node major');

  const installer = readFileSync(resolve(root, 'apps/site/install.sh'), 'utf8');
  assert.match(installer, new RegExp(`^MIN_NODE_MAJOR=${minimum}$`, 'm'));
});
