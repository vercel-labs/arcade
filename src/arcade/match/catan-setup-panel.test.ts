import assert from 'node:assert/strict';
import test from 'node:test';
import { catanSeatColors, catanSetupSelection, seatsDropdown } from './catan-setup-panel.ts';

test('Catan setup defaults to a four-player table', () => {
  assert.equal(seatsDropdown.index, 2);
  assert.equal(catanSeatColors().length, 4);
  assert.equal(catanSetupSelection()?.length, 4);
});
