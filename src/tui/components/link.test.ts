import assert from 'node:assert/strict';
import test from 'node:test';
import { Link } from './link.ts';

test('Link reads as underlined text rather than a button', () => {
  let followed = 0;
  const link = Link({ id: 'spend', label: 'view spend', onClick: () => followed++ });
  assert.equal(link.text, 'view spend');
  assert.equal(link.style.padding, 0, 'a link sits flush with surrounding text');
  assert.equal(link.style.border, undefined, 'no border');
  assert.equal(link.style.background, undefined, 'no fill');
  assert.equal(link.focusable, true, 'reachable by Tab');
  for (const state of ['style', 'hover', 'focus', 'pressed', 'disabled'] as const) {
    const style = state === 'style' ? link.style : link.style[state];
    assert.equal(style?.underline, true, `${state} keeps the underline`);
  }
  link.onClick?.();
  assert.equal(followed, 1);
});

test('Link stops being focusable when disabled', () => {
  const link = Link({ id: 'spend', label: 'view spend', onClick: () => {}, disabled: true });
  assert.equal(link.disabled, true);
});
