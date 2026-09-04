import assert from 'node:assert/strict';
import test from 'node:test';
import { ARCADE_WEBSITE_URL, HOME_MENU_INDEX, MENU_ITEMS, menuItemAction, TUTORIAL_MENU_INDEX } from './menu.ts';

test('the CLI catalogue is in production order with the tutorial one press left of Chess', () => {
  assert.deepEqual(
    MENU_ITEMS.filter((item) => !item.dev).map(({ id }) => id),
    ['chess', 'poker', 'islanders', 'leaderboard', 'achievements', 'website', 'trailer', 'tutorial'],
  );
  assert.equal(HOME_MENU_INDEX, 0);
  assert.equal((TUTORIAL_MENU_INDEX + 1) % MENU_ITEMS.filter((item) => !item.dev).length, HOME_MENU_INDEX);
});

test('the website cover is a stable external action', () => {
  const website = MENU_ITEMS.find(({ id }) => id === 'website');
  assert.deepEqual(website, { id: 'website', title: 'Website', enabled: true, externalUrl: ARCADE_WEBSITE_URL });
  assert.equal(ARCADE_WEBSITE_URL, 'https://ascii-arcade.vercel.app');
  assert.deepEqual(menuItemAction(website), { kind: 'external', url: ARCADE_WEBSITE_URL });
  assert.deepEqual(menuItemAction(MENU_ITEMS.find(({ id }) => id === 'chess')), { kind: 'launch' });
  assert.equal(menuItemAction(MENU_ITEMS.find(({ id }) => id === 'leaderboard')), null);
});

test('the CLI catalogue includes the Trailer as a playable cover', () => {
  assert.deepEqual(MENU_ITEMS.find(({ id }) => id === 'trailer'), { id: 'trailer', title: 'Trailer', enabled: true });
  assert.deepEqual(menuItemAction(MENU_ITEMS.find(({ id }) => id === 'trailer')), { kind: 'launch' });
});
