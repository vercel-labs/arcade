import assert from 'node:assert/strict';
import test from 'node:test';
import { FALLBACK_CREATOR_TINT, loadCreatorWisp, mulberry32 } from './wisp.ts';

test('missing creator logos become first-letter wisps with the neutral fallback tint', () => {
  const wisp = loadCreatorWisp('thinkingmachines', 0, mulberry32(1));
  assert.deepEqual(wisp.tint, FALLBACK_CREATOR_TINT);
  assert.equal(wisp.tex.width, 128);
  assert.equal(wisp.tex.height, 128);

  let opaque = 0;
  for (let i = 3; i < wisp.tex.data.length; i += 4) {
    if (wisp.tex.data[i] > 0) opaque++;
  }
  assert.ok(opaque > 0, 'the generated T mark should contain visible pixels');
  assert.equal(wisp.tex.data[3], 0, 'the generated mark should have a transparent background');
});
