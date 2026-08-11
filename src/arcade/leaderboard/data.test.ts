import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dummyH2HSlices, dummyHeadToHead, dummyLeaderboardData, type LeaderGame } from './data.ts';

const data = dummyLeaderboardData();
// A spread of pairings, so a rule that happens to hold for a blowout is still tested
// against close records and reversed orderings.
const PAIRS: [number, number][] = [
  [0, 1],
  [3, 9],
  [20, 21],
  [9, 3],
  [50, 2],
  [7, 7],
];
const slugs = (i: number, j: number): [string, string] => [data.chess[i].model, data.chess[j].model];

test('dummyHeadToHead: a pairing reads the same from either side, with the sides swapped', () => {
  for (const [i, j] of PAIRS) {
    const [a, b] = slugs(i, j);
    if (a === b) continue;
    const ab = dummyHeadToHead(a, b, 'chess')!;
    const ba = dummyHeadToHead(b, a, 'chess')!;
    assert.equal(ab.total, ba.total);
    assert.equal(ab.aWins, ba.bWins, 'A wins from one side must be A wins from the other');
    assert.equal(ab.bWins, ba.aWins);
  }
});

test('dummyHeadToHead: a model has no record against itself', () => {
  assert.equal(dummyHeadToHead('a/x', 'a/x', 'chess'), null);
  assert.equal(dummyHeadToHead('', 'a/x', 'chess'), null);
});

test('slices: the colour cuts partition the record exactly', () => {
  // The bug this guards: cuts generated independently of the record, so the panel showed
  // 9-0 in the header while the cuts underneath added up to a win for the other side.
  for (const [i, j] of PAIRS) {
    const [a, b] = slugs(i, j);
    if (a === b) continue;
    const rec = dummyHeadToHead(a, b, 'chess')!;
    const s = dummyH2HSlices(a, b, 'chess');
    const w = s.find((x) => x.key === 'white')!;
    const bl = s.find((x) => x.key === 'black')!;
    assert.equal(w.a + bl.a, rec.aWins, `colour cuts must sum to A's wins for ${a} vs ${b}`);
    assert.equal(w.b + bl.b, rec.bWins, `colour cuts must sum to B's wins for ${a} vs ${b}`);
  }
});

test('slices: the length cuts partition the record exactly', () => {
  for (const [i, j] of PAIRS) {
    const [a, b] = slugs(i, j);
    if (a === b) continue;
    const rec = dummyHeadToHead(a, b, 'chess')!;
    const s = dummyH2HSlices(a, b, 'chess');
    const q = s.find((x) => x.key === 'quick')!;
    const l = s.find((x) => x.key === 'long')!;
    assert.equal(q.a + l.a, rec.aWins);
    assert.equal(q.b + l.b, rec.bWins);
  }
});

test('slices: subset cuts never claim more wins than a side actually has', () => {
  for (const game of ['chess', 'poker'] as LeaderGame[]) {
    for (const [i, j] of PAIRS) {
      const [a, b] = slugs(i, j);
      if (a === b) continue;
      const rec = dummyHeadToHead(a, b, game)!;
      for (const s of dummyH2HSlices(a, b, game)) {
        assert.ok(s.a >= 0 && s.b >= 0, `${s.key} went negative`);
        assert.ok(s.a <= rec.aWins, `${s.key} claims ${s.a} of A's ${rec.aWins} wins`);
        assert.ok(s.b <= rec.bWins, `${s.key} claims ${s.b} of B's ${rec.bWins} wins`);
      }
    }
  }
});

test('slices: reversing the pair mirrors every cut', () => {
  const [a, b] = slugs(3, 9);
  const fwd = dummyH2HSlices(a, b, 'chess');
  const rev = dummyH2HSlices(b, a, 'chess');
  assert.equal(fwd.length, rev.length);
  for (const [k, f] of fwd.entries()) {
    assert.equal(f.key, rev[k].key);
    assert.equal(f.a, rev[k].b, `${f.key} must mirror when the pair is reversed`);
    assert.equal(f.b, rev[k].a);
  }
});

test('slices: a cut too small to read is flagged thin', () => {
  for (const [i, j] of PAIRS) {
    const [a, b] = slugs(i, j);
    if (a === b) continue;
    for (const s of dummyH2HSlices(a, b, 'chess')) {
      assert.equal(s.thin, s.a + s.b < 4, `${s.key} thin flag disagrees with its own sample`);
    }
  }
});

test('slices: no record yields no cuts rather than a row of zeroes', () => {
  assert.deepEqual(dummyH2HSlices('a/x', 'a/x', 'chess'), []);
});

test('slices: poker cuts exist and stay inside the record', () => {
  const [a, b] = slugs(0, 5);
  const s = dummyH2HSlices(a, b, 'poker');
  assert.ok(s.length >= 3, 'poker needs its own cuts, not chess ones');
  assert.ok(
    s.every((x) => x.label && x.key),
    'every cut needs a label to sit in the spine',
  );
});
