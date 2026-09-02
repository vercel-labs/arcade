import assert from 'node:assert/strict';
import test from 'node:test';
import { ARCADE_WEBSITE_URL, MENU_ITEMS, menuItemAction } from './menu.ts';

test('the CLI catalogue ends with a stable production website action', () => {
  assert.deepEqual(MENU_ITEMS.at(-1), {
    id: 'website',
    title: 'Website',
    enabled: true,
    externalUrl: ARCADE_WEBSITE_URL,
  });
  assert.equal(ARCADE_WEBSITE_URL, 'https://vercel-arcade.vercel.app');
  assert.deepEqual(menuItemAction(MENU_ITEMS.at(-1)), { kind: 'external', url: ARCADE_WEBSITE_URL });
  assert.deepEqual(menuItemAction(MENU_ITEMS.find(({ id }) => id === 'chess')), { kind: 'launch' });
  assert.equal(menuItemAction(MENU_ITEMS.find(({ id }) => id === 'mahjong')), null);
});
