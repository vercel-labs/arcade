import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { isFirstRun, markFirstRunSeen } from './first-run.ts';

test('the first run is remembered once the home screen has been seen', () => {
  const home = mkdtempSync(join(tmpdir(), 'arcade-first-run-'));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = home;
  try {
    assert.equal(isFirstRun(), true);
    markFirstRunSeen();
    assert.equal(isFirstRun(), false);
    const state = JSON.parse(readFileSync(join(home, 'arcade', 'state.json'), 'utf8')) as { firstMenuAt?: string };
    assert.ok(state.firstMenuAt);
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    rmSync(home, { recursive: true, force: true });
  }
});
