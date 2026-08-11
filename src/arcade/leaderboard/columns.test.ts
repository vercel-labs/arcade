import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildMatrix, COLUMNS, sortRows } from './columns.ts';
import type { LeaderboardData } from './data.ts';

// A hand-built snapshot: three models, one clearly strong, one clearly weak, one thin.
function fixture(): LeaderboardData {
  return {
    chess: [
      { model: 'a/strong', games: 200, wins: 160, losses: 30, draws: 10, winRate: 0.8 },
      { model: 'b/weak', games: 200, wins: 40, losses: 150, draws: 10, winRate: 0.2 },
      { model: 'c/thin', games: 2, wins: 2, losses: 0, draws: 0, winRate: 1 },
    ],
    poker: [
      { model: 'a/strong', hands: 2000, wins: 1200, losses: 800, netChips: 40000, showdownWinPct: 0.7 },
      { model: 'b/weak', hands: 2000, wins: 600, losses: 1400, netChips: -40000, showdownWinPct: 0.3 },
      { model: 'c/thin', hands: 4, wins: 4, losses: 0, netChips: 900, showdownWinPct: 1 },
    ],
    activity: [],
    totals: { modelsRanked: 3, gamesRecorded: 4404, lastGame: 'now' },
    source: 'dummy',
  };
}

const idx = (key: string): number => COLUMNS.findIndex((c) => c.key === key);
const cellFor = (t: ReturnType<typeof buildMatrix>, model: string, key: string) => t.rows.find((r) => r.model === model)!.cells[idx(key)];

test('buildMatrix: the strong model is positive and the weak one negative on every quality column', () => {
  const t = buildMatrix(fixture());
  for (const key of ['chess-win', 'poker-win', 'poker-showdown', 'poker-bb100', 'agg']) {
    assert.ok(cellFor(t, 'a/strong', key).delta > 0, `${key} should be positive for the strong model`);
    assert.ok(cellFor(t, 'b/weak', key).delta < 0, `${key} should be negative for the weak model`);
  }
});

test('buildMatrix: a perfect record over 2 games does not outrank a proven one', () => {
  const t = buildMatrix(fixture());
  // c/thin won 100% of its games; shrinkage must keep it under the 80%-over-200 model.
  assert.ok(cellFor(t, 'c/thin', 'chess-win').delta < cellFor(t, 'a/strong', 'chess-win').delta, 'a 2-game sample must not beat a 200-game one');
});

test('buildMatrix: a model missing from a game gets an absent cell, not a negative one', () => {
  const d = fixture();
  d.poker = d.poker.filter((r) => r.model !== 'c/thin');
  const t = buildMatrix(d);
  const c = cellFor(t, 'c/thin', 'poker-win');
  assert.equal(c.present, false, 'no record must be absent, not zero-with-a-tile');
  assert.equal(c.delta, 0, 'an absent cell carries no deviation');
});

test('buildMatrix: the aggregate averages only the in-aggregate columns', () => {
  const t = buildMatrix(fixture());
  const inAgg = COLUMNS.map((c, i) => (c.inAggregate ? i : -1)).filter((i) => i >= 0);
  assert.ok(inAgg.length > 0, 'at least one column must feed the aggregate');
  for (const model of ['a/strong', 'b/weak', 'c/thin']) {
    const row = t.rows.find((r) => r.model === model)!;
    const want = inAgg.reduce((a, i) => a + row.cells[i].delta, 0) / inAgg.length;
    assert.ok(Math.abs(row.cells[idx('agg')].delta - want) < 1e-9, `aggregate mismatch for ${model}`);
  }
});

test('buildMatrix: bb/100 and style columns are excluded from the aggregate', () => {
  // Guards the unit bug: averaging big blinds into a mean of percentage points.
  assert.equal(COLUMNS[idx('poker-bb100')].inAggregate, false);
  assert.equal(COLUMNS[idx('chess-decisive')].inAggregate, false);
  for (const c of COLUMNS) {
    if (c.inAggregate) {
      assert.equal(c.unit, 'pp', `${c.key} must be percentage points to be averaged`);
      assert.notEqual(c.polarity, 0, `${c.key} has no good direction, so it cannot be averaged`);
    }
  }
});

test('buildMatrix: every column gets a symmetric, non-degenerate domain', () => {
  const t = buildMatrix(fixture());
  assert.equal(t.domains.length, COLUMNS.length);
  for (const [i, d] of t.domains.entries()) {
    assert.ok(d.hi > d.lo, `${COLUMNS[i].key} domain must have span`);
    assert.ok(Math.abs(d.lo + d.hi) < 1e-9, `${COLUMNS[i].key} domain must be symmetric about zero`);
  }
});

test('buildMatrix: a sub-1pp column keeps a tight domain instead of snapping to a round decade', () => {
  // fitSymmetric snaps out to a power of ten, which would flatten every tile to neutral.
  const t = buildMatrix(fixture());
  const d = t.domains[idx('chess-win')];
  assert.ok(d.hi <= 1, 'a rate delta can never exceed 1');
  assert.ok(d.hi > 0.05, `expected a real span, got ${d.hi}`);
});

test('buildMatrix: covers every model in either game, chess order first', () => {
  const d = fixture();
  d.poker.push({ model: 'z/poker-only', hands: 500, wins: 300, losses: 200, netChips: 5000, showdownWinPct: 0.6 });
  const t = buildMatrix(d);
  assert.deepEqual(
    t.rows.map((r) => r.model),
    ['a/strong', 'b/weak', 'c/thin', 'z/poker-only'],
    'a poker-only model still deserves a row',
  );
  assert.equal(cellFor(t, 'z/poker-only', 'chess-win').present, false);
});

test('sortRows: quality columns sort by value, style columns by magnitude', () => {
  const t = buildMatrix(fixture());
  const byWin = sortRows(t, idx('chess-win'), true);
  assert.equal(byWin[0].model, 'a/strong', 'best quality first');
  assert.equal(byWin.at(-1)?.model, 'b/weak');

  // c/thin is 100% decisive (no draws) — the most unusual, so first on a style sort.
  const byStyle = sortRows(t, idx('chess-decisive'), true);
  const mags = byStyle.map((r) => Math.abs(r.cells[idx('chess-decisive')].delta));
  assert.deepEqual(mags, [...mags].sort((a, b) => b - a), 'a style column sorts by distance from typical');
});

test('sortRows: ascending reverses, and absent cells stay last either way', () => {
  const d = fixture();
  d.poker = d.poker.filter((r) => r.model !== 'c/thin');
  const t = buildMatrix(d);
  const col = idx('poker-win');
  assert.equal(sortRows(t, col, true).at(-1)?.model, 'c/thin', 'no record sorts last descending');
  assert.equal(sortRows(t, col, false).at(-1)?.model, 'c/thin', 'and last ascending too');
});

test('sortRows: does not mutate the table', () => {
  const t = buildMatrix(fixture());
  const before = t.rows.map((r) => r.model);
  sortRows(t, idx('chess-win'), false);
  assert.deepEqual(
    t.rows.map((r) => r.model),
    before,
  );
});
