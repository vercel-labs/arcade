import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openBrowser } from './open-browser.ts';

test('hosted browser requests use a private OSC without exposing secrets to a subprocess', () => {
  const previous = process.env.ARCADE_HOSTED_TERMINAL;
  const writes: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.env.ARCADE_HOSTED_TERMINAL = '1';
  process.stdout.write = ((chunk: string | Uint8Array) => { writes.push(String(chunk)); return true; }) as typeof process.stdout.write;
  try {
    openBrowser('https://vercel.com/login?code=abc');
  } finally {
    process.stdout.write = original;
    if (previous === undefined) delete process.env.ARCADE_HOSTED_TERMINAL;
    else process.env.ARCADE_HOSTED_TERMINAL = previous;
  }
  assert.deepEqual(writes, [`\x1b]778;open=${encodeURIComponent('https://vercel.com/login?code=abc')}\x07`]);
});
