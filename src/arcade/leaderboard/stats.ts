// Statistics the leaderboard needs to be honest about its own data.
//
// Win rates here come from tens of games, not thousands, so a bare percentage
// implies precision the sample cannot support: 79.5% over 39 games and 78.9% over
// 19 games are not distinguishable results. The screen therefore ranks on the
// point estimate but DRAWS a confidence interval, so a thin sample reads as a wide
// smear rather than a crisp position, and two overlapping intervals visibly mean
// "tied". Everything below is pure so it can be unit-tested without a renderer.

// Wilson score interval — the standard choice for a proportion from few trials.
// It stays inside 0..1 and, unlike the normal approximation, doesn't collapse to a
// zero-width interval when p hits 0 or 1 (a model that won all 6 of its games is
// not "100% ± 0").
export interface Interval {
  lo: number;
  hi: number;
  point: number;
}

const Z = 1.96; // 95%

export function wilson(wins: number, n: number): Interval {
  if (n <= 0) return { lo: 0, hi: 1, point: 0 };
  const p = wins / n;
  const z2 = Z * Z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const spread = (Z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { lo: Math.max(0, center - spread), hi: Math.min(1, center + spread), point: p };
}

// Below this many games a row is drawn de-emphasized and marked with a hollow
// point: the estimate exists but shouldn't be read as a ranking.
export const THIN_SAMPLE = 15;

// ---- shrinkage: the ranking key ----
//
// Ranking on a raw average lets one lucky game top the board — 1 win from 1 game is
// 100%, which beats 99 from 100. The fix is to blend the model's own average with the
// FIELD's average, weighted by how much evidence the model has:
//
//   score = (n/(n+m))·own + (m/(n+m))·field
//
// n/(n+m) is a confidence dial: at n=m the score is half the model's own record and
// half the field's, and it approaches the model's own record as n grows. Volume
// therefore doesn't add to the score — it decides how much of the score is the
// model's own. This is IMDb's weighted rating and BoardGameGeek's "Geek Rating".
//
// Chosen over a Wilson lower bound because Wilson is only defined for a PROPORTION:
// it ranks chess win rate fine but cannot touch poker's chips-per-hand, which is an
// unbounded signed mean. Shrinkage handles both, so the two boards share one
// mechanism and one explanation. It also parks an unproven model at the field
// average rather than at the bottom — absence of evidence is not evidence of
// weakness.
//
// `m` is the evidence half-way point, in the same unit as `n`.
export function shrink(own: number, n: number, field: number, m: number): number {
  if (n <= 0) return field;
  return (n / (n + m)) * own + (m / (n + m)) * field;
}

// Evidence half-way points. Chess resolves quickly (a win rate over ~20 games is
// already informative); poker per-hand results are far noisier, so a few hundred
// hands still deserve heavy pull toward the field.
export const SHRINK_GAMES = 20;
export const SHRINK_HANDS = 200;

// Poker's rate unit: big blinds won per 100 hands, the standard volume-independent
// poker win rate. The arcade's tables are $10/$20, so one big blind is 20 chips.
export const BIG_BLIND = 20;

export function bbPer100(chips: number, hands: number): number {
  if (hands <= 0) return 0;
  return (chips / hands / BIG_BLIND) * 100;
}

// A shared axis domain for every row's interval track. Rows are compared to each
// other, so they must share one scale — but a 0..100% domain wastes most of the
// track when every model sits between 60% and 80%. Fit the domain to the data
// (padded and snapped to 5% steps) and label its bounds in the header, which keeps
// a zoomed domain honest: it's an axis, not a bar implying magnitude from zero.
export interface Domain {
  lo: number;
  hi: number;
}

// Fit to the RANKED values (the point estimates), not to the union of every
// interval. A handful of thin-sample rows have intervals spanning almost 0..1, and
// including them collapses every marker into three cells; intervals instead clamp
// flush to the axis ends, which reads correctly as "runs past the edge".
export function fitDomain(values: number[]): Domain {
  if (values.length === 0) return { lo: 0, hi: 1 };
  let lo = 1;
  let hi = 0;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const snap = (v: number, dir: 1 | -1): number => {
    const step = 0.05;
    return Math.max(0, Math.min(1, dir > 0 ? Math.ceil(v / step) * step : Math.floor(v / step) * step));
  };
  const out = { lo: snap(lo - 0.01, -1), hi: snap(hi + 0.01, 1) };
  // Guard a degenerate domain (one row, or every interval identical).
  if (out.hi - out.lo < 0.1) return { lo: Math.max(0, out.lo - 0.05), hi: Math.min(1, out.lo + 0.05) };
  return out;
}

// Map a value in the domain to a cell column in 0..width-1, clamped so an interval
// running past the axis ends flush with it instead of vanishing.
export function toCell(v: number, d: Domain, width: number): number {
  if (width <= 1) return 0;
  const t = (v - d.lo) / (d.hi - d.lo);
  return Math.max(0, Math.min(width - 1, Math.round(t * (width - 1))));
}

// Axis ticks: a handful of round values inside the domain, each with the cell it
// lands on. These become BOTH the header's labels and the faint gridlines the rows
// are read against — a real axis instead of a field of filler dots.
export interface Tick {
  value: number;
  cell: number;
}

export function ticksFor(d: Domain, width: number, want = 4, unit = 0.05): Tick[] {
  const span = d.hi - d.lo;
  if (span <= 0 || width <= 1) return [];
  // Round the ideal spacing up to a whole number of units so labels stay tidy.
  const rawStep = span / Math.max(1, want);
  const step = Math.max(unit, Math.ceil(rawStep / unit) * unit);
  const first = Math.ceil(d.lo / step - 1e-9) * step;
  const out: Tick[] = [];
  for (let v = first; v <= d.hi + 1e-9; v += step) {
    const cell = toCell(v, d, width);
    if (!out.some((t) => t.cell === cell)) out.push({ value: v, cell });
  }
  return out;
}

// A domain centered on zero, for a signed measure (poker's net chips). Symmetric so
// the zero line lands mid-track and "up" and "down" are drawn at the same scale.
export function fitSymmetric(values: number[]): Domain {
  let m = 0;
  for (const v of values) m = Math.max(m, Math.abs(v));
  if (m === 0) return { lo: -1, hi: 1 };
  // Snap out to a round number so the labeled bounds read cleanly.
  const mag = 10 ** Math.floor(Math.log10(m));
  const snapped = Math.ceil(m / mag) * mag;
  return { lo: -snapped, hi: snapped };
}

// ---- signed deltas (the metric heatmap) ----
//
// A heatmap of absolute rates is unreadable: chess win rates cluster in 60–80%, so every
// tile lands on the same step and the grid is one flat color. The readable quantity is the
// distance from the FIELD — zero means "average", and the ramp diverges from there.
//
// The delta is taken on the SHRUNK figure, not the raw one, so a model with 8 games lands
// near zero rather than posting a ±20pp tile it hasn't earned. Volume therefore decides how
// far from the field a model is allowed to appear, which is the same contract the standings
// board ranks on — the two views can't disagree about who is good.
export function matrixDelta(own: number, n: number, field: number, m: number): number {
  return shrink(own, n, field, m) - field;
}

// Below this share of the domain a delta reads as "no signal" and takes the neutral
// midpoint instead of an arm. Without a dead zone the sign of statistical noise picks a
// hue, and a field of near-average models flickers green/red with no meaning.
const ZERO_BAND = 0.08;

export type RampBin = { arm: 'pos' | 'neg' | 'zero'; step: number };

// Map a signed delta onto one of `steps` lightness steps per arm. The domain is symmetric
// (see fitSymmetric) so both arms are scaled identically and "up" and "down" of equal size
// are equally dark. Magnitude is measured as a share of the domain rather than in absolute
// units, which is what lets each column carry its own scale.
export function rampStep(value: number, d: Domain, steps: number): RampBin {
  const max = Math.max(Math.abs(d.lo), Math.abs(d.hi));
  if (max <= 0 || steps <= 0 || !Number.isFinite(value)) return { arm: 'zero', step: 0 };
  const mag = Math.min(1, Math.abs(value) / max);
  if (mag < ZERO_BAND) return { arm: 'zero', step: 0 };
  const t = (mag - ZERO_BAND) / (1 - ZERO_BAND);
  const step = Math.max(0, Math.min(steps - 1, Math.floor(t * steps)));
  return { arm: value > 0 ? 'pos' : 'neg', step };
}
