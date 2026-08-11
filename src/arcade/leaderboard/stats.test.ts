import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bbPer100, fitDomain, fitSymmetric, matrixDelta, rampStep, SHRINK_GAMES, SHRINK_HANDS, shrink, THIN_SAMPLE, ticksFor, toCell, wilson } from './stats.ts';

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

test('THIN_SAMPLE marks the dummy data rows we expect to de-emphasize', () => {
  assert.ok(THIN_SAMPLE > 0 && THIN_SAMPLE < 30);
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

test('matrixDelta: an average model sits at zero', () => {
  assert.equal(matrixDelta(0.5, 100, 0.5, SHRINK_GAMES), 0);
});

test('matrixDelta: a thin sample is pulled toward zero, a fat one is believed', () => {
  const field = 0.5;
  const thin = matrixDelta(0.9, 8, field, SHRINK_GAMES);
  const fat = matrixDelta(0.9, 400, field, SHRINK_GAMES);
  assert.ok(thin > 0 && fat > 0, 'both beat the field');
  assert.ok(thin < fat / 3, 'the same 90% over 8 games must read far weaker than over 400');
  assert.ok(fat > 0.37, 'a large sample keeps almost all of its edge');
});

test('matrixDelta: no games is exactly zero, not a negative', () => {
  // A model with no record is unproven, not bad — it must not paint a red tile.
  assert.equal(matrixDelta(0, 0, 0.42, SHRINK_GAMES), 0);
});

test('matrixDelta: sign follows which side of the field the model is on', () => {
  assert.ok(matrixDelta(0.3, 60, 0.5, SHRINK_GAMES) < 0);
  assert.ok(matrixDelta(0.7, 60, 0.5, SHRINK_GAMES) > 0);
});

test('rampStep: near-zero deltas take the neutral midpoint, not an arm', () => {
  const d = fitSymmetric([-0.2, 0.2]);
  assert.equal(rampStep(0, d, 5).arm, 'zero');
  assert.equal(rampStep(0.001, d, 5).arm, 'zero', 'noise must not pick a hue');
  assert.equal(rampStep(-0.001, d, 5).arm, 'zero');
});

test('rampStep: arms follow the sign and saturate at the domain edge', () => {
  const d = fitSymmetric([-0.2, 0.2]);
  assert.equal(rampStep(0.2, d, 5).arm, 'pos');
  assert.equal(rampStep(-0.2, d, 5).arm, 'neg');
  assert.equal(rampStep(0.2, d, 5).step, 4, 'the domain edge is the last step');
  assert.equal(rampStep(999, d, 5).step, 4, 'past the edge clamps rather than overflowing');
});

test('rampStep: step rises monotonically with magnitude', () => {
  const d = fitSymmetric([-1, 1]);
  let prev = -1;
  for (const v of [0.1, 0.3, 0.5, 0.7, 0.9, 1]) {
    const s = rampStep(v, d, 5).step;
    assert.ok(s >= prev, `step must not go backwards at ${v}`);
    prev = s;
  }
});

test('rampStep: equal magnitudes either side land on the same step', () => {
  const d = fitSymmetric([-0.5, 0.5]);
  for (const v of [0.12, 0.25, 0.4, 0.5]) {
    assert.equal(rampStep(v, d, 5).step, rampStep(-v, d, 5).step, `arms must be scaled alike at ${v}`);
  }
});

test('rampStep: a degenerate domain is neutral rather than dividing by zero', () => {
  assert.equal(rampStep(1, { lo: 0, hi: 0 }, 5).arm, 'zero');
  assert.equal(rampStep(Number.NaN, fitSymmetric([-1, 1]), 5).arm, 'zero');
});

test('rampStep: every step index is reachable and in range', () => {
  const d = fitSymmetric([-1, 1]);
  const seen = new Set<number>();
  for (let i = 0; i <= 100; i++) {
    const { step } = rampStep(i / 100, d, 5);
    assert.ok(step >= 0 && step < 5, 'step must index the ramp');
    seen.add(step);
  }
  assert.equal(seen.size, 5, 'a ramp with an unreachable step wastes a color');
});
