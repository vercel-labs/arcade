// The leaderboard's data contract + a dummy provider.
//
// The screen renders from a LeaderboardData snapshot and knows nothing about
// where it came from. The dummy provider fabricates deterministic stats for the
// FULL gateway model catalog (so the win-rate list is long + the creator filter
// is meaningful) — a live provider that fetches the proxy's read endpoint drops
// in behind the same interface later, unchanged for the view.

import { creators } from '../match/models.ts';

export type LeaderGame = 'chess' | 'poker';

export interface ChessRow {
  model: string; // gateway slug, e.g. 'anthropic/claude-opus-4.8'
  games: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number; // 0..1
}

export interface PokerRow {
  model: string;
  hands: number;
  wins: number; // hands won
  losses: number;
  netChips: number; // signed total
  showdownWinPct: number; // 0..1
}

export interface ActivityPoint {
  day: string;
  chess: number;
  poker: number;
}

export interface LeaderboardData {
  chess: ChessRow[]; // ranked (win rate desc)
  poker: PokerRow[]; // ranked (net chips desc)
  activity: ActivityPoint[];
  totals: { modelsRanked: number; gamesRecorded: number; lastGame: string };
  source: 'dummy' | 'live';
}

export interface LeaderboardProvider {
  load(): Promise<LeaderboardData>;
}

// FNV-1a → a stable per-model seed, so dummy stats don't jitter between renders.
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function genChess(): ChessRow[] {
  const rows: ChessRow[] = [];
  for (const c of creators()) {
    for (const m of c.models) {
      const h = hashStr(`chess|${m.id}`);
      const games = 8 + (h % 55); // 8..62
      const winRate = 0.22 + ((h >>> 6) % 58) / 100; // 0.22..0.79
      const wins = Math.round(games * winRate);
      const draws = (h >>> 12) % (Math.round(games * 0.12) + 1);
      const losses = Math.max(0, games - wins - draws);
      rows.push({ model: m.id, games, wins, losses, draws, winRate: games ? wins / games : 0 });
    }
  }
  return rows.sort((a, b) => b.winRate - a.winRate || b.games - a.games);
}

function genPoker(): PokerRow[] {
  const rows: PokerRow[] = [];
  for (const c of creators()) {
    for (const m of c.models) {
      const h = hashStr(`poker|${m.id}`);
      const hands = 60 + (h % 340); // 60..399
      const winRate = 0.32 + ((h >>> 6) % 30) / 100; // 0.32..0.61
      const wins = Math.round(hands * winRate);
      const losses = hands - wins;
      const netChips = ((h >>> 10) % 40001) - 20000; // -20000..20000
      const showdownWinPct = 0.35 + ((h >>> 16) % 35) / 100; // 0.35..0.69
      rows.push({ model: m.id, hands, wins, losses, netChips, showdownWinPct });
    }
  }
  return rows.sort((a, b) => b.netChips - a.netChips);
}

// ~30 days of activity with a gentle ramp + weekly wobble (deterministic).
function dummyActivity(): ActivityPoint[] {
  const out: ActivityPoint[] = [];
  const start = Date.UTC(2026, 5, 25);
  for (let i = 0; i < 30; i++) {
    const d = new Date(start + i * 86400000);
    const wobble = [3, 5, 4, 6, 5, 2, 1][i % 7];
    out.push({ day: d.toISOString().slice(0, 10), chess: Math.max(0, Math.round(2 + i * 0.15) + (wobble % 4)), poker: Math.max(0, Math.round(4 + i * 0.4) + wobble) });
  }
  return out;
}

export function dummyLeaderboardData(): LeaderboardData {
  const chess = genChess();
  const poker = genPoker();
  const gamesRecorded = chess.reduce((s, r) => s + r.games, 0) + poker.reduce((s, r) => s + r.hands, 0);
  return { chess, poker, activity: dummyActivity(), totals: { modelsRanked: chess.length, gamesRecorded, lastGame: '2m ago' }, source: 'dummy' };
}

export class DummyLeaderboardProvider implements LeaderboardProvider {
  async load(): Promise<LeaderboardData> {
    return dummyLeaderboardData();
  }
}

// The ranked model slugs for a game (populates the head-to-head dropdowns).
export function modelsForGame(data: LeaderboardData, game: LeaderGame): string[] {
  return game === 'chess' ? data.chess.map((r) => r.model) : data.poker.map((r) => r.model);
}

// Creators that have models — for the win-rate creator filter dropdown.
export function leaderboardCreators(): { slug: string; name: string }[] {
  return creators()
    .filter((c) => c.models.length > 0)
    .map((c) => ({ slug: c.slug, name: c.name }));
}

export interface H2HRecord {
  total: number;
  aWins: number;
  bWins: number;
  draws: number; // chess only
}

function hashPair(lo: string, hi: string): number {
  return hashStr(`${lo}|${hi}`);
}

export function dummyHeadToHead(a: string, b: string, game: LeaderGame): H2HRecord | null {
  if (!a || !b || a === b) return null;
  const lo = a < b ? a : b;
  const hi = a < b ? b : a;
  const h = hashPair(lo, hi);
  const total = 8 + (h % 13); // 8..20
  const draws = game === 'chess' ? (h >>> 4) % 3 : 0; // unsigned shift — signed >> can go negative
  const loWins = (h >>> 8) % (total - draws + 1);
  const hiWins = total - draws - loWins;
  return { total, aWins: a === lo ? loWins : hiWins, bWins: a === lo ? hiWins : loWins, draws };
}

// A cut of one pairing's record: how many of THIS KIND of game each side won.
//
// The aggregate record is usually the least informative number a rivalry has — the
// canonical demonstration is Djokovic–Nadal, level at 31-29 overall while every slice
// underneath it (by surface, by round, by tournament) is lopsided. So the head-to-head
// screen leads with the cuts and treats the total as context.
//
// Every slice below is one the live records can actually produce: colour comes from the
// participant's role, game length from the action count, the ending from
// ChessMatchDetails.resultReason, and the poker cuts from PokerHandResult's
// reachedShowdown / wonAnyPot / netChips plus PokerAppliedAction.allIn.
export interface H2HSlice {
  key: string;
  label: string;
  a: number;
  b: number;
  /** A cut too small to read anything into, drawn de-emphasized. */
  thin: boolean;
}

const SLICE_THIN = 4;

// Take a deterministic share 0..n of one side's wins. Cuts are built by dividing each
// side's OWN wins, never by re-splitting the pot: a panel whose cuts disagree with the
// aggregate above them is worse than one that shows no cuts at all.
function share(wins: number, seed: number, lo: number, hi: number): number {
  if (wins <= 0) return 0;
  const t = lo + ((seed & 0xff) / 255) * (hi - lo);
  return Math.max(0, Math.min(wins, Math.round(wins * t)));
}

export function dummyH2HSlices(a: string, b: string, game: LeaderGame): H2HSlice[] {
  const rec = dummyHeadToHead(a, b, game);
  if (!rec) return [];
  // Cuts are a property of the PAIRING, so they're computed in canonical lo/hi order and
  // oriented to the caller only at the end — the same contract dummyHeadToHead follows.
  // Seeding off argument position instead makes a pairing change shape when the two models
  // are passed the other way round.
  const aIsLo = a < b;
  const h = hashPair(aIsLo ? a : b, aIsLo ? b : a);
  const loWins = aIsLo ? rec.aWins : rec.bWins;
  const hiWins = aIsLo ? rec.bWins : rec.aWins;
  const mk = (key: string, label: string, lo: number, hi: number): H2HSlice => {
    const [av, bv] = aIsLo ? [lo, hi] : [hi, lo];
    return { key, label, a: av, b: bv, thin: lo + hi < SLICE_THIN };
  };

  if (game === 'chess') {
    // Colour and length are PARTITIONS: each pair of cuts sums back to that side's wins.
    const loWhite = share(loWins, h >>> 3, 0.25, 0.75);
    const hiWhite = share(hiWins, h >>> 7, 0.25, 0.75);
    const loQuick = share(loWins, h >>> 11, 0.3, 0.8);
    const hiQuick = share(hiWins, h >>> 15, 0.3, 0.8);
    // Endings are SUBSETS of each side's wins, not a partition — a win can be neither a
    // checkmate nor a resignation (flag, adjudication).
    return [
      mk('white', 'as white', loWhite, hiWhite),
      mk('black', 'as black', loWins - loWhite, hiWins - hiWhite),
      mk('quick', 'inside 30 moves', loQuick, hiQuick),
      mk('long', 'past 30 moves', loWins - loQuick, hiWins - hiQuick),
      mk('mate', 'by checkmate', share(loWins, h >>> 19, 0.2, 0.5), share(hiWins, h >>> 23, 0.2, 0.5)),
    ];
  }
  return [
    mk('hands', 'hands won', loWins, hiWins),
    mk('showdown', 'showdowns won', share(loWins, h >>> 7, 0.3, 0.7), share(hiWins, h >>> 11, 0.3, 0.7)),
    mk('allin', 'all-in pots', share(loWins, h >>> 15, 0.1, 0.4), share(hiWins, h >>> 19, 0.1, 0.4)),
    mk('big', 'pots over 20bb', share(loWins, h >>> 23, 0.3, 0.6), share(hiWins, h >>> 5, 0.3, 0.6)),
  ];
}
