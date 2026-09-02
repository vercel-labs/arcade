import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stringWidth } from '../engine/width.ts';

test('menu keeps one shared label and reserves its wide icon consistently', async () => {
  const { MENU_BUTTON_LABEL } = await import('./theme.ts');
  assert.equal(MENU_BUTTON_LABEL, '☰ menu');
  assert.equal(stringWidth(MENU_BUTTON_LABEL), 7);
});
