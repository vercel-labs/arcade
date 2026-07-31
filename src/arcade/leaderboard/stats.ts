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

// ---- diverging scale (the head-to-head matrix) ----
//
// Win rate against a specific opponent is polarity data: it diverges around 50%,
// where "even" must read as nothing. So hue carries the SIGN (blue = row wins, red
// = row loses) and glyph density carries the MAGNITUDE — a composite encoding, which
// also means the scale survives being read by someone who can't separate the hues.

export type DivergingBin = { sign: 'win' | 'loss' | 'even'; step: 0 | 1 | 2 };

// `rate` is the row's win rate vs the column (0..1). Distance from 0.5 picks one of
// three lightness steps per arm, so the whole scale is 7 classes — at the ceiling
// past which adjacent bins stop being separable. Shading glyphs (░▒▓) were tried
// first and rejected: at 8px per cell their dither patterns read as moiré, not as
// magnitude. Solid fills on a validated lightness ramp are both cleaner and safer.
export function divergingBin(rate: number): DivergingBin {
  const delta = rate - 0.5;
  const mag = Math.abs(delta);
  if (mag < 0.06) return { sign: 'even', step: 0 };
  const step = mag < 0.18 ? 0 : mag < 0.3 ? 1 : 2;
  return { sign: delta > 0 ? 'win' : 'loss', step };
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

// ---- head-to-head duel bar ----
//
// Cell spans for a center-anchored diverging bar of `width` cells. Each side is
// scaled to the HALF it grows into, so a share of the total maps to a share of that
// arm: 9–0 fills one side completely and 5–4 reads as a near tie. (Scaling each arm
// by the full width instead silently clamps every close record to "total blowout".)
export interface DuelArms {
  mid: number; // the even-point column
  aCells: number; // cells filled leftward from just left of the draw block
  bCells: number; // cells filled rightward from just right of it
  drawCells: number; // cells straddling the midpoint
}

export function duelArms(aWins: number, bWins: number, draws: number, width: number): DuelArms {
  const total = Math.max(1, aWins + bWins + draws);
  const mid = Math.floor(width / 2);
  const drawCells = Math.round((draws / total) * mid);
  // Draws eat into both arms, so the arms share what's left of each half.
  const arm = Math.max(0, mid - Math.ceil(drawCells / 2));
  const decided = Math.max(1, aWins + bWins);
  return { mid, drawCells, aCells: Math.min(arm, Math.round((aWins / decided) * arm)), bCells: Math.min(arm, Math.round((bWins / decided) * arm)) };
}
