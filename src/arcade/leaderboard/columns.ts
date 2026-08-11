// The metric heatmap's column spec: what a matrix column IS, independent of how it's drawn.
//
// The matrix asks "how good is each model, and at what?", so it spans every game at once —
// unlike standings and head-to-head, which look at one game. Each column is a metric, each
// cell the model's signed distance from the field on that metric (see stats.ts matrixDelta).
//
// Columns are declared as data rather than written into the renderer because the live
// telemetry records carry far more than the dummy provider does (per-move records for chess,
// per-action for poker). Adding "blunder rate" later should be one entry here, not a new
// branch in view.ts.

import { bbPer100, fitSymmetric, matrixDelta, SHRINK_GAMES, SHRINK_HANDS, type Domain } from './stats.ts';
import type { ChessRow, LeaderboardData, PokerRow } from './data.ts';

export type Band = 'chess' | 'poker';

// 'pp' = percentage points of a rate; 'bb100' = big blinds per 100 hands. The unit decides
// how a cell is formatted AND whether it can be averaged into the aggregate.
export type Unit = 'pp' | 'bb100';

// Which direction is "good". +1 = higher is better, -1 = lower is better (a cost signal,
// e.g. a blunder or timeout rate), 0 = neither — a STYLE metric where more is just
// different. Polarity is per column, not per sign: without it, a cost signal paints its
// improvements red. A 0 column takes a neutral one-hue ramp so the display never asserts a
// goodness direction the metric doesn't have.
export type Polarity = 1 | -1 | 0;

export interface Sample {
  own: number;
  n: number;
}

export interface MatrixColumn {
  key: string;
  band: Band | null; // null → the aggregate column, which reads from the others
  label: string;
  unit: Unit;
  polarity: Polarity;
  // Averaged into the aggregate. Requires 'pp' (averaging bb/100 into a mean of percentage
  // points is meaningless) and a real direction (a style column has no better/worse to add).
  inAggregate: boolean;
  m: number; // shrinkage evidence half-way point, in the same unit as n
  chess?: (r: ChessRow) => Sample;
  poker?: (r: PokerRow) => Sample;
}

const rate = (num: number, den: number): number => (den > 0 ? num / den : 0);

export const COLUMNS: MatrixColumn[] = [
  { key: 'agg', band: null, label: 'aggregate', unit: 'pp', polarity: 1, inAggregate: false, m: 0 },
  {
    key: 'chess-win',
    band: 'chess',
    label: 'win%',
    unit: 'pp',
    polarity: 1,
    inAggregate: true,
    m: SHRINK_GAMES,
    chess: (r) => ({ own: r.winRate, n: r.games }),
  },
  {
    // Non-draw rate: how often the model forces a result either way. Sharp play, not good
    // play — hence polarity 0.
    key: 'chess-decisive',
    band: 'chess',
    label: 'decisive%',
    unit: 'pp',
    polarity: 0,
    inAggregate: false,
    m: SHRINK_GAMES,
    chess: (r) => ({ own: rate(r.wins + r.losses, r.games), n: r.games }),
  },
  {
    key: 'poker-win',
    band: 'poker',
    label: 'win%',
    unit: 'pp',
    polarity: 1,
    inAggregate: true,
    m: SHRINK_HANDS,
    poker: (r) => ({ own: rate(r.wins, r.hands), n: r.hands }),
  },
  {
    key: 'poker-showdown',
    band: 'poker',
    label: 'showdn%',
    unit: 'pp',
    polarity: 1,
    inAggregate: true,
    m: SHRINK_HANDS,
    poker: (r) => ({ own: r.showdownWinPct, n: r.hands }),
  },
  {
    // The real poker skill measure, but in big blinds — not percentage points — so it is
    // shown in its own unit and kept out of the aggregate rather than silently mixed in.
    key: 'poker-bb100',
    band: 'poker',
    label: 'bb/100',
    unit: 'bb100',
    polarity: 1,
    inAggregate: false,
    m: SHRINK_HANDS,
    poker: (r) => ({ own: bbPer100(r.netChips, r.hands), n: r.hands }),
  },
];

export interface MatrixCell {
  delta: number; // signed distance from the field, in the column's unit
  n: number;
  present: boolean; // false → the model has no record for this game at all
}

export interface MatrixRow {
  model: string;
  cells: MatrixCell[]; // index-aligned with COLUMNS
}

export interface MatrixTable {
  columns: MatrixColumn[];
  rows: MatrixRow[];
  domains: Domain[]; // index-aligned with COLUMNS — each column carries its own scale
}

// Volume-weighted pooled mean: Σ(own·n) / Σn. One formula covers every column, including
// bb/100 (where it works out exactly equal to bbPer100 of the pooled chips and hands,
// because bb/100 is linear in both).
function pooledMean(samples: Sample[]): number {
  let num = 0;
  let den = 0;
  for (const s of samples) {
    num += s.own * s.n;
    den += s.n;
  }
  return den > 0 ? num / den : 0;
}

// Every sample for one column, over the FULL data. The field mean and the color domain are
// both computed unfiltered on purpose: a model's tile must mean the same thing whether or
// not the creator filter is narrowing the view (the same rule standings' fieldMean follows).
function samplesFor(col: MatrixColumn, d: LeaderboardData): Map<string, Sample> {
  const out = new Map<string, Sample>();
  if (col.chess) for (const r of d.chess) out.set(r.model, col.chess(r));
  if (col.poker) for (const r of d.poker) out.set(r.model, col.poker(r));
  return out;
}

// Every model with a record in any game, chess order first so the table has a stable
// default shape. The matrix spans games, so a poker-only model still gets a row.
function allModels(d: LeaderboardData): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of d.chess) if (!seen.has(r.model)) (seen.add(r.model), out.push(r.model));
  for (const r of d.poker) if (!seen.has(r.model)) (seen.add(r.model), out.push(r.model));
  return out;
}

// Builds the WHOLE table — every model, every column. Row filtering (the creator dropdown)
// happens downstream on `rows`, which is what keeps a tile's color fixed while the view
// narrows: both the field mean and the color domain are computed over everything here.
export function buildMatrix(d: LeaderboardData): MatrixTable {
  // Per-column samples + field mean, computed once for the whole table.
  const samples = COLUMNS.map((c) => samplesFor(c, d));
  const fields = COLUMNS.map((c, i) => (c.band === null ? 0 : pooledMean([...samples[i].values()])));

  const rows: MatrixRow[] = allModels(d).map((model) => {
    const cells: MatrixCell[] = COLUMNS.map((c, i) => {
      if (c.band === null) return { delta: 0, n: 0, present: true }; // filled in below
      const s = samples[i].get(model);
      if (!s) return { delta: 0, n: 0, present: false };
      return { delta: matrixDelta(s.own, s.n, fields[i], c.m), n: s.n, present: true };
    });

    // The aggregate is the mean over ALL in-aggregate columns, counting a missing game as
    // zero rather than skipping it. That dilution is the point: a model proven only at chess
    // has shown less than one proven at both, and should sit closer to the field.
    const agg = COLUMNS.map((c, i) => (c.inAggregate ? cells[i].delta : null)).filter((v): v is number => v !== null);
    const aggIdx = COLUMNS.findIndex((c) => c.band === null);
    if (aggIdx >= 0 && agg.length > 0) {
      cells[aggIdx] = { delta: agg.reduce((a, v) => a + v, 0) / agg.length, n: cells.reduce((a, c) => a + c.n, 0), present: true };
    }
    return { model, cells };
  });

  // Domains from the built rows so the aggregate column gets one too. Symmetric about zero,
  // so equal deviations up and down are drawn at the same weight.
  const domains = COLUMNS.map((_, i) => fitSymmetricDeltas(rows.map((r) => r.cells[i]).filter((c) => c.present).map((c) => c.delta)));
  return { columns: COLUMNS, rows, domains };
}

// fitSymmetric snaps out to a round power of ten, which is right for an axis with printed
// bounds but far too coarse for a fraction-of-a-percent delta (0.04 snaps to 0.1, wasting
// most of the ramp). Percentage-point columns instead take the raw magnitude.
function fitSymmetricDeltas(values: number[]): Domain {
  let m = 0;
  for (const v of values) m = Math.max(m, Math.abs(v));
  if (m === 0) return { lo: -1, hi: 1 };
  return m < 1 ? { lo: -m, hi: m } : fitSymmetric(values);
}

// Sort rows by one column's delta. Style columns (polarity 0) sort by magnitude — "most
// unusual first" — because for those neither end is the good end.
export function sortRows(t: MatrixTable, col: number, desc: boolean): MatrixRow[] {
  const style = t.columns[col]?.polarity === 0;
  const key = (r: MatrixRow): number => {
    const c = r.cells[col];
    return style ? Math.abs(c.delta) : c.delta;
  };
  // Rows with no record sink to the bottom in BOTH directions: they carry no value to rank,
  // so letting them ride the sort would put "unknown" above "measured and bad" on an ascend.
  const present = t.rows.filter((r) => r.cells[col]?.present);
  const absent = t.rows.filter((r) => !r.cells[col]?.present);
  present.sort((a, b) => (desc ? key(b) - key(a) : key(a) - key(b)));
  return [...present, ...absent];
}
