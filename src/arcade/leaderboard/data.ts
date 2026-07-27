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
