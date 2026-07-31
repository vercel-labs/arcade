import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bbPer100, divergingBin, duelArms, fitDomain, fitSymmetric, SHRINK_GAMES, SHRINK_HANDS, shrink, THIN_SAMPLE, ticksFor, toCell, wilson } from './stats.ts';

test('wilson: interval brackets the point estimate', () => {
  const iv = wilson(31, 39);
  assert.ok(iv.lo < iv.point && iv.point < iv.hi);
  assert.equal(iv.point, 31 / 39);
});

test('wilson: a thinner sample is a wider interval at the same rate', () => {
  const few = wilson(15, 19);
  const many = wilson(47, 60);
  // ~79% either way, so only n separates them.
  assert.ok(Math.abs(few.point - many.point) < 0.02);
  assert.ok(few.hi - few.lo > many.hi - many.lo);
});

test('wilson: a perfect record still carries uncertainty', () => {
  const iv = wilson(6, 6);
  assert.equal(iv.point, 1);
  assert.ok(iv.lo < 1, 'lower bound must sit below 100%');
  assert.ok(iv.hi <= 1);
});

test('wilson: stays inside 0..1 and handles no games', () => {
  for (const [w, n] of [
    [0, 8],
    [8, 8],
    [1, 1],
  ]) {
    const iv = wilson(w, n);
    assert.ok(iv.lo >= 0 && iv.hi <= 1, `${w}/${n} escaped 0..1`);
  }
  const none = wilson(0, 0);
  assert.deepEqual(none, { lo: 0, hi: 1, point: 0 });
});

test('fitDomain: snaps outward to 5% steps and covers every ranked value', () => {
  const ivs = [wilson(31, 39), wilson(15, 19), wilson(47, 60)];
  const d = fitDomain(ivs.map((iv) => iv.point));
  for (const iv of ivs) {
    assert.ok(d.lo <= iv.point && iv.point <= d.hi, 'domain must contain the point estimate');
  }
  assert.ok(Math.abs((d.lo * 100) % 5) < 1e-6);
  assert.ok(Math.abs((d.hi * 100) % 5) < 1e-6);
});

test('fitDomain: degenerate input still yields a usable span', () => {
  const d = fitDomain([wilson(5, 10).point]);
  assert.ok(d.hi > d.lo);
  assert.deepEqual(fitDomain([]), { lo: 0, hi: 1 });
});

test('toCell: maps domain ends to track ends and clamps beyond them', () => {
  const d = { lo: 0.4, hi: 0.8 };
  assert.equal(toCell(0.4, d, 20), 0);
  assert.equal(toCell(0.8, d, 20), 19);
  assert.equal(toCell(0.6, d, 21), 10);
  assert.equal(toCell(0.1, d, 20), 0, 'below the domain clamps to the left end');
  assert.equal(toCell(0.99, d, 20), 19, 'above the domain clamps to the right end');
});

test('divergingBin: sign follows the 50% midpoint, magnitude follows distance', () => {
  assert.equal(divergingBin(0.5).sign, 'even');
  assert.equal(divergingBin(0.52).sign, 'even', 'near-even must read as nothing');
  assert.equal(divergingBin(0.75).sign, 'win');
  assert.equal(divergingBin(0.25).sign, 'loss');
  // A higher lightness step the further from even.
  assert.ok(divergingBin(0.95).step > divergingBin(0.62).step);
  assert.ok(divergingBin(0.05).step > divergingBin(0.38).step);
});

test('THIN_SAMPLE marks the dummy data rows we expect to de-emphasize', () => {
  assert.ok(THIN_SAMPLE > 0 && THIN_SAMPLE < 30);
});

test('duelArms: a blowout fills one arm and leaves the other empty', () => {
  const a = duelArms(9, 0, 0, 26);
  assert.equal(a.bCells, 0);
  assert.equal(a.aCells, a.mid, 'the winning arm fills its half');
  assert.equal(a.drawCells, 0);
});

test('duelArms: a near-tie reads as a near-tie, not a blowout', () => {
  const a = duelArms(5, 4, 0, 26);
  assert.ok(Math.abs(a.aCells - a.bCells) <= 2, `arms should be close, got ${a.aCells} vs ${a.bCells}`);
  assert.ok(a.aCells > a.bCells, 'the leader still leads');
  // The bug this guards: scaling each arm by the full width clamped both to the half.
  assert.ok(a.aCells < a.mid, 'a 5-4 record must not fill the whole arm');
});

test('duelArms: an exact tie is symmetric', () => {
  const a = duelArms(6, 6, 0, 24);
  assert.equal(a.aCells, a.bCells);
});

test('duelArms: arms never overflow their half, and draws take from both', () => {
  for (const [w, l, d] of [
    [3, 3, 6],
    [0, 0, 12],
    [20, 1, 3],
    [1, 1, 0],
  ]) {
    const a = duelArms(w, l, d, 26);
    assert.ok(a.aCells >= 0 && a.bCells >= 0 && a.drawCells >= 0);
    assert.ok(a.aCells + Math.floor(a.drawCells / 2) <= a.mid, `left side overflowed for ${w}/${l}/${d}`);
    assert.ok(a.bCells + Math.ceil(a.drawCells / 2) <= a.mid + 1, `right side overflowed for ${w}/${l}/${d}`);
  }
});

test('duelArms: all draws leaves both arms empty', () => {
  const a = duelArms(0, 0, 10, 26);
  assert.equal(a.aCells, 0);
  assert.equal(a.bCells, 0);
  assert.ok(a.drawCells > 0);
});

test('fitSymmetric: zero sits mid-track and both signs share one scale', () => {
  const d = fitSymmetric([19973, -8400, 120]);
  assert.equal(d.lo, -d.hi, 'domain must be symmetric about zero');
  assert.ok(d.hi >= 19973, 'domain must cover the largest magnitude');
  assert.equal(toCell(0, d, 27), 13, 'zero lands on the middle cell');
});

test('fitSymmetric: all-zero input still yields a usable span', () => {
  const d = fitSymmetric([0, 0]);
  assert.ok(d.hi > d.lo);
});

test('ticksFor: ticks are round, inside the domain, and at distinct cells', () => {
  const d = { lo: 0.15, hi: 0.85 };
  const ts = ticksFor(d, 26);
  assert.ok(ts.length >= 3 && ts.length <= 6, `expected a handful of ticks, got ${ts.length}`);
  const cells = new Set(ts.map((t) => t.cell));
  assert.equal(cells.size, ts.length, 'no two ticks may share a cell');
  for (const t of ts) {
    assert.ok(t.value >= d.lo - 1e-9 && t.value <= d.hi + 1e-9, `${t.value} outside domain`);
    assert.ok(t.cell >= 0 && t.cell < 26);
    assert.ok(Math.abs((t.value * 100) % 5) < 1e-6, `${t.value} is not a round 5% step`);
  }
});

test('ticksFor: a chips domain uses its own unit and brackets zero', () => {
  const d = fitSymmetric([19973, -8400]);
  const ts = ticksFor(d, 26, 4, 10000);
  assert.ok(
    ts.some((t) => Math.abs(t.value) < 1e-9),
    'a symmetric domain must place a tick on zero',
  );
});

test('ticksFor: degenerate inputs return nothing rather than looping', () => {
  assert.deepEqual(ticksFor({ lo: 0.5, hi: 0.5 }, 26), []);
  assert.deepEqual(ticksFor({ lo: 0, hi: 1 }, 1), []);
});

test('shrink: a lucky 1-of-1 does not outrank a proven 99-of-100', () => {
  const field = 0.5;
  const lucky = shrink(1, 1, field, SHRINK_GAMES);
  const proven = shrink(0.99, 100, field, SHRINK_GAMES);
  assert.ok(proven > lucky, `99/100 (${proven}) must beat 1/1 (${lucky})`);
  // The whole point: the lucky row lands near the field average, not at the top.
  assert.ok(Math.abs(lucky - field) < 0.1, 'a single game should sit close to the field mean');
});

test('shrink: more evidence pulls the score toward the model own average', () => {
  const field = 0.5;
  const own = 0.8;
  const few = shrink(own, 5, field, SHRINK_GAMES);
  const some = shrink(own, 50, field, SHRINK_GAMES);
  const many = shrink(own, 5000, field, SHRINK_GAMES);
  assert.ok(few < some && some < many, 'score must rise monotonically with evidence');
  assert.ok(many > 0.79 && many <= own, 'a huge sample converges on the raw average');
  assert.ok(few < 0.62, 'a tiny sample stays near the field mean');
});

test('shrink: at n = m the score is the midpoint of own and field', () => {
  assert.ok(Math.abs(shrink(0.9, SHRINK_GAMES, 0.5, SHRINK_GAMES) - 0.7) < 1e-9);
});

test('shrink: works on signed unbounded means (poker chips), not just proportions', () => {
  const field = 5;
  assert.ok(shrink(-300, 10, field, SHRINK_HANDS) < 0.1 + field, 'a big loss over 10 hands barely moves off the field mean');
  assert.ok(shrink(-300, 100000, field, SHRINK_HANDS) < -290, 'a big loss over many hands is believed');
});

test('shrink: no games falls back to the field average', () => {
  assert.equal(shrink(0, 0, 0.42, SHRINK_GAMES), 0.42);
});

test('bbPer100: converts chips per hand into big blinds per 100 hands', () => {
  // 20 chips/hand at a 20-chip big blind = 1 bb/hand = 100 bb/100.
  assert.equal(bbPer100(20 * 50, 50), 100);
  assert.equal(bbPer100(-20 * 50, 50), -100);
  assert.equal(bbPer100(1234, 0), 0, 'no hands must not divide by zero');
});

test('bbPer100 is volume-independent where net chips is not', () => {
  // Same skill, ten times the volume: net chips differ 10x, bb/100 is identical.
  assert.equal(bbPer100(1000, 100), bbPer100(10000, 1000));
});
