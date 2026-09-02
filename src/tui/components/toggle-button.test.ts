import assert from 'node:assert/strict';
import test from 'node:test';
import { ToggleButton } from './toggle-button.ts';

test('ToggleButton keeps one fixed-width row with a moving thumb and trailing value', () => {
  let selected = false;
  const off = ToggleButton({ id: 'example', value: false, onChange: (value) => { selected = value; } });
  const on = ToggleButton({ id: 'example', value: true, onChange: () => {} });
  assert.equal(off.style.width, 9);
  assert.equal(on.style.width, 9);
  assert.equal(off.style.height, 1);
  assert.equal(on.style.height, 1);
  const offTrack = off.children?.[0].children?.[0].children ?? [];
  const onTrack = on.children?.[0].children?.[0].children ?? [];
  assert.notDeepEqual(offTrack[0]?.style.background, offTrack[4]?.style.background);
  assert.notDeepEqual(onTrack[0]?.style.background, onTrack[4]?.style.background);
  assert.deepEqual(offTrack[0]?.style.background, onTrack[4]?.style.background, 'white thumb moves from left to right');
  assert.equal(off.children?.[0].children?.[1].text, 'off');
  assert.equal(on.children?.[0].children?.[1].text, 'on ');
  off.onClick?.();
  assert.equal(selected, true);
});
