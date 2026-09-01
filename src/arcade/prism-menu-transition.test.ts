import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

test('CLI applies shared ink only from the prism into Cover Flow', () => {
  assert.ok(main.includes("from '../cinematic/transitions/timed-ink-transition.ts'"));
  assert.ok(main.includes('function startPrismToMenu()'));
  assert.ok(main.includes("if (mode === 'prism' && !updateModalOpen)"));
  assert.equal((main.match(/startPrismToMenu\(\);/g) ?? []).length, 2, 'only keyboard and pointer prism entry trigger ink');
  assert.ok(main.includes('prismToMenu.compose(source, destination)'));
  assert.ok(main.includes('enterMenu(false)'));
  assert.ok(!main.includes("from '../web/"), 'CLI must never import browser adapters');
});

test('ordinary home navigation and cover launch remain outside the ink controller', () => {
  assert.ok(main.includes('onHome: () => enterMenu()'));
  assert.ok(main.includes('coverflow.renderLaunch(target, launchSel, launchT)'));
  assert.ok(!main.includes('prismToMenu.compose(source, destination, launchSel)'));
});
