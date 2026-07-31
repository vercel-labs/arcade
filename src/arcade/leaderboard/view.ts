// The leaderboard screen: ONE metric at a time, chosen with clickable tabs.
//   • Standings     — ranked rows (left) whose selected model drives the wisp +
//                     stat card (right).
//   • Head-to-Head  — two models' records as one diverging bar, their wisps
//                     direct-labeled beneath.
//   • Matrix        — who-beats-whom as a diverging heatmap.
// Everything is mouse-clickable and reuses the shared TUI components. The left is
// a dark scrim; the right region is transparent so LeaderboardScene's creator
// wisp(s) show through (which creators is decided by activeWispCreators()).
//
// Design notes that are easy to undo by accident:
//   · Win rate's MAGNITUDE is encoded by position on a shared axis, never by row
//     color. Coloring a row by its own rate spends the one identity channel
//     re-encoding what position already shows, and made every row green.
//   · Creator tint is brand ASSOCIATION, not identity: the 26 gateway creators
//     collapse into ~6 blues, ~5 oranges and 5 identical grays, so the tint never
//     appears without the creator's name beside it.
//   · The interval, not the point, is the headline mark — see stats.ts.

import type { RGB } from '../../engine/index.ts';
import { ASCIIFont, asciiFontLines, Box, Button, Dropdown, FrameBuffer, ScrollBox, Slot, Text, type LayoutBox, type Node, type Screen, type Style } from '../../tui/index.ts';
import { UI_CHROME_PILL } from '../theme.ts';
import { creatorTint } from '../scenes/wisp.ts';
import { dummyHeadToHead, leaderboardCreators, modelsForGame, type ChessRow, type LeaderGame, type LeaderboardData, type PokerRow } from './data.ts';
import { bbPer100, divergingBin, duelArms, fitDomain, fitSymmetric, SHRINK_GAMES, SHRINK_HANDS, shrink, THIN_SAMPLE, ticksFor, toCell, wilson, type Domain, type Interval, type Tick } from './stats.ts';

export type Metric = 'standings' | 'headtohead' | 'matrix';

// Diverging poles for polarity data (matrix cells, net chips). Validated as a pair
// against this screen's surface: ΔE 21.0 under protanopia, 28.2 normal vision.
const WIN_BLUE: RGB = [74, 144, 217];
const LOSS_RED: RGB = [220, 80, 80];
const EVEN_GRAY: RGB = [90, 94, 110];

const INK: RGB = [212, 214, 224];
const INK_DIM: RGB = [120, 124, 140];
const RULE: RGB = [42, 45, 58];
const GRID: RGB = [30, 32, 41]; // recessive axis gridline, one shade off the scrim
const TRACK: RGB = [48, 51, 64];
const SCRIM: [number, number, number, number] = [10, 12, 18, 0.93];
const CARD: [number, number, number, number] = [14, 16, 24, 0.95];
const CARD_BG: RGB = [14, 16, 24];
const ALL = 'all creators';

// Layout constants shared by the flex tree AND the 3D scene's viewport, so the wisp
// backdrop is inset to exactly the region the opaque panels don't cover (mirrors how
// chess reserves CHAT_WIDTH). Left reserve = root left pad + panel width + body gap.
const ROOT_PAD_X = 3;
const BODY_GAP = 2;
const STANDINGS_PANEL_W = 80;
const H2H_PANEL_W = 60;
const TOP_RESERVE = 4; // top pad (1) + tab row (1) + rule (1) + column gap (1)

// Row geometry. The track is the shared win-rate axis every row is plotted on.
const COL_RANK = 4;
const COL_MODEL = 18;
const COL_CREATOR = 9;
const TRACK_W = 20;
const COL_SCORE = 7;
const COL_RAW = 7;
const COL_N = 4;

// Column widths for a given panel width. Priority order when space runs short: the
// track gives up width first, then the raw (uncorrected) value, then the creator, then
// the sample size — never the model name or the SCORE, which are the row's whole point.
interface Cols {
  inner: number;
  model: number;
  creator: number; // 0 = hidden
  track: number;
  raw: number; // 0 = hidden
  n: number; // 0 = hidden
}

function colsFor(panelW: number): Cols {
  const inner = panelW - 2;
  let creator = COL_CREATOR;
  let raw = COL_RAW;
  let n = COL_N;
  let model = COL_MODEL;
  let track = TRACK_W;
  // spine + rank + model + [creator] + track + score + [raw] + [n], one gap after each.
  const need = (): number => 1 + (COL_RANK - 1) + model + creator + track + COL_SCORE + raw + n + 4 + (creator ? 1 : 0) + (raw ? 1 : 0) + (n ? 1 : 0);
  track = Math.max(8, track - Math.max(0, need() - inner));
  if (need() > inner) raw = 0;
  if (need() > inner) n = 0;
  if (need() > inner) creator = 0;
  if (need() > inner) model = Math.max(8, model - (need() - inner));
  return { inner, model, creator, track, raw, n };
}

// Panel widths adapt to the terminal: at 80 columns a fixed 80-wide panel filled the
// whole screen and the stat card landed on top of the list. The panel gives up width
// first, then the card is dropped entirely once there's no room beside it.
const MIN_SCENE_W = 24; // narrower than this and the wisp isn't worth reserving for

function panelWidth(cols: number, want: number): number {
  const budget = cols - ROOT_PAD_X * 2 - BODY_GAP;
  return Math.max(30, Math.min(want, budget - MIN_SCENE_W));
}
// Room beside the standings panel for the stat card?
function cardFits(cols: number): boolean {
  return cols - ROOT_PAD_X * 2 - BODY_GAP - panelWidth(cols, STANDINGS_PANEL_W) >= STAT_CARD_MIN_W;
}

// The cells the panels + chrome cover for the active metric, so main.ts / the snapshot
// can inset the LeaderboardScene into the region that's actually left over. Standings
// also reserves the BOTTOM rows the stat card occupies, so the wisp centers in the gap
// above it rather than being half-covered.
export function leaderboardSceneReserve(cols: number): { left: number; top: number; bottom: number } {
  if (metric === 'standings') {
    return { left: ROOT_PAD_X + panelWidth(cols, STANDINGS_PANEL_W) + BODY_GAP, top: TOP_RESERVE, bottom: cardFits(cols) ? STAT_CARD_H + 1 : 1 };
  }
  if (metric === 'headtohead') return { left: ROOT_PAD_X + panelWidth(cols, H2H_PANEL_W) + BODY_GAP, top: TOP_RESERVE, bottom: 3 };
  return { left: 0, top: TOP_RESERVE, bottom: 0 }; // matrix: full width, no wisps
}

let metric: Metric = 'standings';
let game: LeaderGame = 'chess';
let current: LeaderboardData | null = null;
// Standings' selected model — drives the stat card AND which creator's wisp the
// scene shows, which is what turns the wisp from wallpaper into a detail view.
let selected = '';
// Head-to-head's two compared model slugs — swapped ONLY by clicking a wisp, which
// opens the shared chess/poker model-swap modal (see main.ts). No inline dropdown lives
// in the 3D scene.
let h2hA = '';
let h2hB = '';

const GAMES: LeaderGame[] = ['chess', 'poker'];

const rowList = new ScrollBox({ id: 'lb-winlist', width: STANDINGS_PANEL_W - 2, height: 20, rows: [] });
const creatorDrop = new Dropdown({ id: 'lb-creator', items: [ALL], width: 20, rows: 12, searchable: true, searchPlaceholder: 'filter creator…', index: 0 });
const gameDrop = new Dropdown({ id: 'lb-game', items: GAMES, width: 10, bare: true, index: 0, onSelect: (i) => setGame(GAMES[i] ?? 'chess') });

export function mountLeaderboard(ui: Screen): void {
  ui.mount(rowList);
  ui.mount(creatorDrop);
  ui.mount(gameDrop);
}

export function setLeaderboardData(data: LeaderboardData): void {
  current = data;
  creatorDrop.setItems([ALL, ...leaderboardCreators().map((c) => c.slug)], 0);
  refillModels();
}
export function setMetric(m: Metric): void {
  metric = m;
}
export function setGame(g: LeaderGame): void {
  game = g;
  rowList.scroll = 0;
  // Keep the header dropdown in sync when the game is set programmatically (startup,
  // the snapshot tool) rather than by picking from the list.
  const i = GAMES.indexOf(g);
  if (i >= 0 && gameDrop.value !== g) gameDrop.setItems(GAMES, i);
  refillModels();
}

// Seed the selection + the two head-to-head slugs from the current game's catalog.
function refillModels(): void {
  const ms = current ? modelsForGame(current, game) : [];
  selected = ms[0] ?? '';
  h2hA = ms[0] ?? '';
  h2hB = ms[1] ?? ms[0] ?? '';
}

// Standings selection. Clicking a row sets this; the snapshot tool sets it to review
// a non-default selection (the wisp follows it, so this is what makes the 3D scene a
// detail view rather than a backdrop).
export function setLeaderboardSelection(slug: string): void {
  selected = slug;
}
// Head-to-head plumbing for main.ts's wisp-click → shared swap modal.
export function leaderboardH2HActive(): boolean {
  return metric === 'headtohead';
}
export function leaderboardH2HModel(which: 'a' | 'b'): string {
  return which === 'a' ? h2hA : h2hB;
}
export function setLeaderboardH2HModel(which: 'a' | 'b', slug: string): void {
  if (which === 'a') h2hA = slug;
  else h2hB = slug;
}

function shortModel(slug: string): string {
  const slash = slug.lastIndexOf('/');
  return slash === -1 ? slug : slug.slice(slash + 1);
}
function creatorOf(slug: string): string {
  return slug.split('/')[0] ?? slug;
}
function tintOf(slug: string): RGB {
  const t = creatorTint(creatorOf(slug));
  return [t.x, t.y, t.z];
}
// Text cells reserve width but don't clip, so long names must be truncated to
// avoid spilling into the next column.
function fit(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}
function cell(text: string, width: number, color: RGB | string = INK, bold = false): Node {
  return Text({ text, style: { width, color, bold } });
}
function rowBox(cells: Node[], style: Partial<Style> = {}): Node {
  return Box({ flexDirection: 'row', gap: 1, ...style }, cells);
}
function rule(width: number, color: RGB = RULE): Node {
  return Text({ text: '─'.repeat(Math.max(0, width)), style: { color } });
}
// A rule that fills whatever width flex gives it (Text can't grow — it's sized by
// its own string), so the tab strip's underline runs to the screen edge.
function ruleFill(color: RGB = RULE): Node {
  return FrameBuffer({
    height: 1,
    style: { flexGrow: 1 },
    draw: (surf, box) => {
      for (let i = 0; i < box.w; i++) surf.setCell(box.x + i, box.y, '─', color, [0, 0, 0]);
    },
  });
}

// The active creator filter slug, or null for "all".
function creatorFilterSlug(): string | null {
  const v = creatorDrop.value;
  return !v || v === ALL ? null : v;
}
function filteredChess(d: LeaderboardData): ChessRow[] {
  const s = creatorFilterSlug();
  return s ? d.chess.filter((r) => creatorOf(r.model) === s) : d.chess;
}
function filteredPoker(d: LeaderboardData): PokerRow[] {
  const s = creatorFilterSlug();
  return s ? d.poker.filter((r) => creatorOf(r.model) === s) : d.poker;
}

// A game-agnostic view of one ranked row, so the row renderer and the stat card
// don't each need a chess branch and a poker branch.
interface Standing {
  model: string;
  n: number; // games (chess) / hands (poker)
  wins: number;
  losses: number;
  draws: number;
  rate: number; // hands/games won as a proportion (poker uses this only in the card)
  iv: Interval;
  // `raw` is the observed rate in the board's unit (win % for chess, bb/100 for
  // poker); `score` is that same figure shrunk toward the field average by volume.
  // The board RANKS and PLOTS score, and shows raw beside it so the correction is
  // always auditable.
  raw: number;
  score: number;
  netChips?: number;
}

// The field average every row is shrunk toward: pooled across the whole game, not the
// filtered view, so switching the creator filter can't move a model's score.
function fieldMean(d: LeaderboardData): number {
  if (game === 'chess') {
    const games = d.chess.reduce((a, r) => a + r.games, 0);
    return games > 0 ? d.chess.reduce((a, r) => a + r.wins, 0) / games : 0.5;
  }
  const hands = d.poker.reduce((a, r) => a + r.hands, 0);
  return bbPer100(
    d.poker.reduce((a, r) => a + r.netChips, 0),
    hands,
  );
}

function standings(d: LeaderboardData): Standing[] {
  const field = fieldMean(d);
  const rows: Standing[] =
    game === 'chess'
      ? filteredChess(d).map((r) => ({
          model: r.model,
          n: r.games,
          wins: r.wins,
          losses: r.losses,
          draws: r.draws,
          rate: r.winRate,
          iv: wilson(r.wins, r.games),
          raw: r.winRate,
          score: shrink(r.winRate, r.games, field, SHRINK_GAMES),
        }))
      : filteredPoker(d).map((r) => {
          const bb = bbPer100(r.netChips, r.hands);
          return {
            model: r.model,
            n: r.hands,
            wins: r.wins,
            losses: r.losses,
            draws: 0,
            rate: r.hands > 0 ? r.wins / r.hands : 0,
            iv: wilson(r.wins, r.hands),
            raw: bb,
            score: shrink(bb, r.hands, field, SHRINK_HANDS),
            netChips: r.netChips,
          };
        });
  // Rank on the shrunk score. The provider's own ordering ranks chess on raw win rate
  // and poker on NET chips — the latter is a sum, so it ranks by volume as much as skill.
  return rows.sort((a, b) => b.score - a.score);
}

function selectedStanding(rows: Standing[]): Standing | null {
  return rows.find((r) => r.model === selected) ?? rows[0] ?? null;
}

// Which creators the wisp scene should show for the current metric/selection.
export function activeWispCreators(): string[] {
  if (!current) return [];
  if (metric === 'standings') {
    const sel = selectedStanding(standings(current));
    return sel ? [creatorOf(sel.model)] : [];
  }
  if (metric === 'headtohead') {
    return [h2hA, h2hB].filter((m) => !!m).map(creatorOf);
  }
  return [];
}

// ---- top controls: metric tabs + game pills (+ creator filter) ----

// A tab reads as a tab: label plus an accent underline when active, instead of a
// filled pill. Quieter than the pill bar and consistent with the games' thin chrome.
function tab(id: string, label: string, on: boolean, onClick: () => void): Node {
  return Box({ flexDirection: 'column', alignItems: 'stretch' }, [
    Button({
      id,
      label,
      onClick,
      style: {
        padding: [0, 2],
        background: 'transparent',
        color: on ? INK : INK_DIM,
        bold: on,
        hover: { color: [238, 240, 248] as RGB },
      },
    }),
    Text({ text: '─'.repeat(label.length + 4), style: { color: on ? ([112, 122, 188] as RGB) : RULE } }),
  ]);
}

function controls(onMenu: () => void): Node {
  const left = Box({ flexDirection: 'row', alignItems: 'end', gap: 0 }, [
    Box({ flexDirection: 'column' }, [Text({ text: ' LEADERBOARD ', style: { color: 'accent', bold: true } }), Text({ text: '─'.repeat(13), style: { color: RULE } })]),
    tab('lb-tab-standings', 'standings', metric === 'standings', () => setMetric('standings')),
    tab('lb-tab-h2h', 'head-to-head', metric === 'headtohead', () => setMetric('headtohead')),
    tab('lb-tab-matrix', 'matrix', metric === 'matrix', () => setMetric('matrix')),
  ]);
  // A bare dropdown, not one pill per game: it sits on the tab strip's baseline at the
  // same 1-row height as everything else there, and adding a third game is a list entry
  // rather than another pill competing for header width.
  const right = Box({ flexDirection: 'row', alignItems: 'end', gap: 2 }, [
    Box({ flexDirection: 'row', alignItems: 'center', gap: 1 }, [Text({ text: 'game', style: { color: INK_DIM } }), Slot('lb-game')]),
    // ☰ menu (home / controls / account / telemetry / quit) top-right, like the other screens.
    Button({ id: 'lb-menu-button', label: '☰ menu', onClick: onMenu, style: UI_CHROME_PILL }),
  ]);
  // The tab underlines and this filler are one continuous rule across the strip, so
  // the active tab reads as a notch in a line rather than a floating dash.
  return Box({ flexDirection: 'row', alignItems: 'end', justifyContent: 'between' }, [left, ruleFill(), right]);
}

// ---- standings ----

// One row's track, plotted on the axis the list is RANKED by — otherwise the chart
// contradicts the ranking (poker ranks on net chips, so a win-rate track put the
// leader at the far left).
//
// Chess ranks on win rate, a proportion: dotted axis, 50% reference tick, the Wilson
// interval as a bar in the creator's tint, the point estimate as a marker (hollow +
// dimmed when the sample is too thin to rank on).
//
// Poker ranks on net chips, a signed total: a bar from a real zero line, blue up /
// red down. Magnitude from a meaningful baseline, so here a bar is the honest form.
function trackRow(st: Standing, d: Domain, on: boolean, width: number, ticks: Tick[]): Node {
  return FrameBuffer({
    width,
    height: 1,
    draw: (surf, box) => {
      const thin = st.n < THIN_SAMPLE;
      const tint = tintOf(st.model);
      // Recessive gridlines at the header's tick positions — a real axis the rows are
      // read against. (A dot at every other cell was tried and read as filler noise
      // across the empty stretch below the pack.)
      for (const t of ticks) surf.setCell(box.x + t.cell, box.y, '│', on ? [46, 49, 62] : GRID, CARD_BG);
      if (game === 'poker') {
        const zero = toCell(0, d, box.w);
        const end = toCell(st.score, d, box.w);
        const up = st.score >= 0;
        const fill = up ? WIN_BLUE : LOSS_RED;
        const bar: RGB = thin ? [fill[0] * 0.55, fill[1] * 0.55, fill[2] * 0.55] : fill;
        const [from, to] = end >= zero ? [zero, end] : [end, zero];
        // '▄' not '█': a half block leaves a gap between rows, so a run of same-signed
        // bars reads as separate bars instead of one solid slab. Lower half, so it
        // aligns with its own row's text rather than the row above's.
        for (let i = from; i <= to; i++) surf.setCell(box.x + i, box.y, '▄', bar, CARD_BG);
        surf.setCell(box.x + zero, box.y, '│', [96, 100, 120], CARD_BG);
        return;
      }
      // The coin-flip line is the one gridline that carries meaning, so it stays a
      // step brighter than the rest.
      if (0.5 >= d.lo && 0.5 <= d.hi) surf.setCell(box.x + toCell(0.5, d, box.w), box.y, '│', [62, 66, 82], CARD_BG);
      // A bare dot at the score. No confidence interval: sample size is now built into
      // the score itself, so drawing the interval too would triple-encode it (n column,
      // dimming, width) and shout loudest about the least interesting variable.
      const p = toCell(st.score, d, box.w);
      surf.setCell(box.x + p, box.y, thin ? '○' : '●', on ? [244, 246, 252] : tint, CARD_BG);
    },
  });
}

// ASCII '-', not U+2212: the 8x8 font has no MINUS SIGN, so a typographic minus
// renders as a blank and silently turns a loss into a gain.
function chips(v: number): string {
  const a = Math.abs(v);
  const s = a >= 1000 ? `${(a / 1000).toFixed(1)}k` : String(a);
  return `${v >= 0 ? '+' : '-'}${s}`;
}
// bb/100 — signed, so it always carries an explicit sign except at zero. ASCII '-',
// not U+2212: the 8x8 font has no MINUS SIGN, so a typographic minus renders blank and
// silently turns a loss into a gain.
function bb(v: number): string {
  if (Math.abs(v) < 0.05) return '0';
  const a = Math.abs(v);
  return `${v > 0 ? '+' : '-'}${a >= 100 ? a.toFixed(0) : a.toFixed(1)}`;
}
// The board's ranked unit, for a row value or an axis tick.
function scoreText(v: number): string {
  return game === 'poker' ? bb(v) : pct(v);
}

// A 1-cell creator spine. Groups a long list by vendor at a glance — but it is only
// ever a grouping aid, because the creator name always sits two columns to its right.
function spine(st: Standing, on: boolean): Node {
  const t = tintOf(st.model);
  return Text({ text: '▌', style: { color: on ? t : ([t[0] * 0.62, t[1] * 0.62, t[2] * 0.62] as RGB) } });
}

function standingRow(st: Standing, rank: number, d: Domain, c: Cols, ticks: Tick[]): Node {
  const on = st.model === selected;
  const thin = st.n < THIN_SAMPLE;
  const podium = rank <= 3;
  const rankInk = podium || on ? INK : INK_DIM;
  const nameInk: RGB = on ? [244, 246, 252] : thin ? INK_DIM : INK;
  // A Box (not a Button) so the row can hold per-column children; any node with an
  // onClick is interactive and gets hover styling by id.
  return {
    kind: 'box',
    id: `lb-row-${st.model}`,
    onClick: () => {
      selected = st.model;
    },
    // One cell short of the list's inner width: the last column belongs to the
    // ScrollBox's scrollbar, and a full-width row tinted it on hover/selection.
    style: { width: c.inner - 1, flexDirection: 'row', gap: 1, background: on ? ([26, 30, 44] as RGB) : 'transparent', hover: { background: [22, 25, 36] as RGB } },
    children: [
      spine(st, on),
      cell(String(rank).padStart(2), COL_RANK - 1, rankInk, podium),
      cell(fit(shortModel(st.model), c.model), c.model, nameInk, on),
      ...(c.creator ? [cell(fit(creatorOf(st.model), c.creator), c.creator, INK_DIM)] : []),
      trackRow(st, d, on, c.track, ticks),
      // SCORE is the ranked value; RAW is the uncorrected observation beside it, so the
      // shrinkage is always auditable rather than a black box.
      cell(scoreText(st.score).padStart(6), COL_SCORE, on ? ([244, 246, 252] as RGB) : thin ? INK_DIM : INK, true),
      ...(c.raw ? [cell(scoreText(st.raw).padStart(6), c.raw, INK_DIM)] : []),
      ...(c.n ? [cell(String(st.n).padStart(3), c.n, INK_DIM)] : []),
    ],
  };
}

// A tick label centered under its gridline, clipped to the track. Labels are placed
// by cell rather than spaced by hand so they stay registered to the gridlines the
// rows are drawn against.
function axisLabels(d: Domain, ticks: Tick[], width: number): Node {
  const poker = game === 'poker';
  return FrameBuffer({
    width,
    height: 1,
    draw: (surf, box) => {
      let lastEnd = -1;
      for (const t of ticks) {
        const label = poker ? bb(t.value) : `${Math.round(t.value * 100)}%`;
        const start = Math.max(0, Math.min(box.w - label.length, t.cell - Math.floor(label.length / 2)));
        if (start <= lastEnd) continue; // would collide with the previous label
        surf.drawText(box.x + start, box.y, label, INK_DIM, CARD_BG);
        lastEnd = start + label.length;
      }
    },
  });
}

// What SCORE means. Without it the column reads as an unexplained second percentage,
// and the dimmed rows look like a bug rather than a sample-size warning.
//
// Phrasings run longest-first and the first one that FITS wins, rather than switching
// on hand-picked width breakpoints — a breakpoint that is even slightly wrong clips
// mid-word ("adjusted for hand◊ under 15 hands").
function trackLegend(c: Cols): Node {
  const poker = game === 'poker';
  const unit = poker ? 'hands' : 'games';
  const rate = poker ? 'bb/100' : 'win%';
  const m = poker ? SHRINK_HANDS : SHRINK_GAMES;
  const thin = `○ under ${THIN_SAMPLE} ${unit}`;
  const candidates = [
    `SCORE = ${rate} adjusted toward field avg until ~${m} ${unit}   ${thin}`,
    `SCORE = ${rate} adjusted for ${unit} played   ${thin}`,
    `SCORE = ${rate} adjusted for ${unit}   ○ n<${THIN_SAMPLE}`,
    `SCORE = adjusted ${rate}`,
    'SCORE = adjusted',
  ];
  const text = candidates.find((t) => t.length <= c.inner) ?? '';
  return Text({ text, style: { color: INK_DIM } });
}

function standingsHeader(d: Domain, c: Cols, ticks: Tick[]): Node {
  // The tick labels are what keep a fitted (non-zero) domain honest: rows are
  // positions on a stated scale, not bars implying magnitude from zero.
  const poker = game === 'poker';
  return Box({ flexDirection: 'column' }, [
    rowBox([
      Text({ text: ' ', style: { width: 1 } }),
      cell('#', COL_RANK - 1, INK_DIM),
      cell('MODEL', c.model, INK_DIM),
      ...(c.creator ? [cell('CREATOR', c.creator, INK_DIM)] : []),
      axisLabels(d, ticks, c.track),
      cell('SCORE'.padStart(6), COL_SCORE, INK_DIM),
      ...(c.raw ? [cell((poker ? 'BB/100' : 'WIN%').padStart(6), c.raw, INK_DIM)] : []),
      ...(c.n ? [cell('  n', c.n, INK_DIM)] : []),
    ]),
    // The rule carries a tick mark at each gridline, so the axis reads as one piece
    // with the column headers above and the gridlines below.
    FrameBuffer({
      width: c.inner,
      height: 1,
      draw: (surf, box) => {
        for (let i = 0; i < box.w; i++) surf.setCell(box.x + i, box.y, '─', RULE, CARD_BG);
        const trackX = 1 + 1 + (COL_RANK - 1) + 1 + c.model + 1 + (c.creator ? c.creator + 1 : 0);
        for (const t of ticks) {
          const x = trackX + t.cell;
          if (x < box.w) surf.setCell(box.x + x, box.y, '┬', [58, 62, 78], CARD_BG);
        }
      },
    }),
  ]);
}

// The top 3 are marked by weight alone. A separator row was tried and removed: it
// overdrew the ScrollBox's scrollbar column and added a phantom row to the list.
function standingsRows(rows: Standing[], d: Domain, c: Cols, ticks: Tick[]): Node[] {
  return rows.map((st, i) => standingRow(st, i + 1, d, c, ticks));
}

// ---- the stat card: the selected model, inspected ----

// Win/loss/draw as one stacked part-to-whole bar. A 1-cell surface gap separates
// the segments so they read as three quantities rather than one striped block.
function outcomeBar(st: Standing, width: number): Node {
  return FrameBuffer({
    width,
    height: 1,
    draw: (surf, box) => {
      const total = Math.max(1, st.wins + st.losses + st.draws);
      const segs: [number, RGB][] = [
        [st.wins, WIN_BLUE],
        [st.losses, LOSS_RED],
        [st.draws, EVEN_GRAY],
      ];
      let x = 0;
      segs.forEach(([v, color], i) => {
        if (v <= 0) return;
        const w = Math.max(1, Math.round((v / total) * (box.w - 2)));
        for (let i2 = 0; i2 < w && x < box.w; i2++, x++) surf.setCell(box.x + x, box.y, '█', color, CARD_BG);
        if (i < segs.length - 1 && x < box.w) x++; // surface gap, not a border
      });
    },
  });
}

// The selected model's detail card. It sits BELOW the wisp and the scene viewport is
// shortened by exactly STAT_CARD_H (see leaderboardSceneReserve), so the two share the
// right-hand region instead of the card floating on top of the orb.
//
// No brand mark here: the wisp directly above it already carries creator identity,
// and a second logo said the same thing twice.
// No border either: a rounded frame around a full-width panel read as a floating
// widget rather than a base for the wisp. The fill alone separates it from the scene,
// which is how the poker/chess HUD cards do it.
const STAT_CARD_H = 8; // padding(2) + title(1) + gap(1) + hero(4)
const STAT_CARD_MIN_W = 34;

function statCard(st: Standing, width: number): Node {
  const tint = tintOf(st.model);
  const inner = width - 4; // horizontal padding, both sides
  const hero = scoreText(st.score);
  // Measure the block-letter figure rather than guessing a column width — "+20.0k" is
  // half again as wide as "79.5%", and a fixed guess clipped the trailing glyph.
  const heroW = asciiFontLines(hero)[0]?.length ?? 0;
  const statsW = Math.max(12, inner - heroW - 2);
  // Four lines, each sized to statsW — the hero is wide, so anything longer overflowed
  // back across it (Text reserves width but does not clip).
  const poker = game === 'poker';
  const observed = poker ? `${bb(st.raw)} bb/100 raw` : `${pct(st.raw)} raw · ci ${Math.round(st.iv.lo * 100)}–${Math.round(st.iv.hi * 100)}%`;
  const stats: Node[] = [
    Text({ text: poker ? 'bb/100 adjusted' : 'win rate adjusted', style: { color: INK_DIM } }),
    Text({ text: fit(st.n < THIN_SAMPLE ? `○ only ${st.n} — mostly field avg` : observed, statsW), style: { color: INK_DIM } }),
    rowBox([
      Text({ text: `${st.wins}W`, style: { color: WIN_BLUE } }),
      Text({ text: `${st.losses}L`, style: { color: LOSS_RED } }),
      ...(game === 'chess' ? [Text({ text: `${st.draws}D`, style: { color: EVEN_GRAY } })] : []),
      // bb/100 is the ranked rate, but the raw chip total is what a poker player
      // actually wants to see, and it appears nowhere else once the board stopped
      // ranking on it.
      st.netChips !== undefined
        ? Text({ text: `· ${chips(st.netChips)}`, style: { color: st.netChips >= 0 ? WIN_BLUE : LOSS_RED } })
        : Text({ text: `· ${st.n}`, style: { color: INK_DIM } }),
    ]),
    outcomeBar(st, statsW),
  ];
  const rank = `#${rankOf(st)} of ${rankTotal}`;
  return Box({ flexDirection: 'column', width, height: STAT_CARD_H, padding: [1, 2], background: CARD, alignItems: 'stretch' }, [
    // Rank belongs with identity, not down in the stats column where it competed with
    // the hero figure for the same row.
    Box({ flexDirection: 'row', justifyContent: 'between' }, [
      rowBox([Text({ text: fit(creatorOf(st.model), 14), style: { color: tint, bold: true } }), Text({ text: '·', style: { color: RULE } }), Text({ text: fit(shortModel(st.model), inner - rank.length - 18), style: { color: INK } })]),
      Text({ text: rank, style: { color: INK_DIM } }),
    ]),
    Box({ height: 1 }),
    // Hero figure beside its supporting numbers: the card is wide and short now, so a
    // horizontal split beats stacking (which pushed the card past the wisp's space).
    Box({ flexDirection: 'row', gap: 2, alignItems: 'start' }, [
      Box({ width: heroW }, [ASCIIFont(hero, { color: st.score < 0 ? LOSS_RED : ([244, 246, 252] as RGB) })]),
      Box({ flexDirection: 'column', flexGrow: 1 }, stats),
    ]),
  ]);
}

// Rank lookup for the card's footer line, filled in each build by standingsView.
let rankIndex = new Map<string, number>();
let rankTotal = 0;
function rankOf(st: Standing): number {
  return rankIndex.get(st.model) ?? 0;
}

function standingsView(data: LeaderboardData, listH: number, regionW: number): Node {
  const rows = standings(data);
  // The axis must be the ranked measure: chips for poker, win rate for chess.
  const d = game === 'poker' ? fitSymmetric(rows.map((r) => r.score)) : fitDomain(rows.map((r) => r.score));
  const panelW = panelWidth(regionW, STANDINGS_PANEL_W);
  const c = colsFor(panelW);
  // Fewer ticks for chips: their labels are wide, so 4 of them collide and get dropped.
  const ticks = game === 'poker' ? ticksFor(d, c.track, 2, 25) : ticksFor(d, c.track, 4, 0.05);
  rankIndex = new Map(rows.map((r, i) => [r.model, i + 1]));
  rankTotal = rows.length;
  rowList.setWidth(c.inner);
  rowList.setHeight(listH);
  rowList.rows = standingsRows(rows, d, c, ticks);
  const title = Box({ flexDirection: 'row', alignItems: 'center', justifyContent: 'between', padding: [0, 1, 0, 0] }, [
    Text({ text: 'STANDINGS', style: { color: 'accent', bold: true } }),
    Box({ flexDirection: 'row', alignItems: 'center', gap: 1 }, [Slot('lb-creator')]),
  ]);
  // No bottom padding: the list runs to the panel's last row, so the scrollbar's travel
  // ends exactly at the panel's bottom edge — which is also the stat card's bottom edge.
  // The legend takes the row that used to be a blank spacer, so it costs no list height.
  const left = Box({ flexDirection: 'column', width: panelW, padding: [1, 0, 0, 2], background: SCRIM, alignItems: 'stretch' }, [title, trackLegend(c), Box({ height: 1 }), standingsHeader(d, c, ticks), Slot('lb-winlist')]);
  const sel = selectedStanding(rows);
  // The right region is a column: the wisp shows through the transparent top, the card
  // occupies the bottom STAT_CARD_H rows, and the scene viewport is shortened to match. The
  // card spans the region's width so it reads as a base for the orb, not a sticker on it.
  const cardW = regionW - ROOT_PAD_X * 2 - panelW - BODY_GAP;
  const right = Box({ flexDirection: 'column', flexGrow: 1, justifyContent: 'end', alignItems: 'stretch' }, sel && cardFits(regionW) ? [statCard(sel, cardW)] : []);
  return Box({ flexDirection: 'row', gap: BODY_GAP, alignItems: 'stretch', flexGrow: 1 }, [left, right]);
}

// ---- head-to-head ----

// One center-anchored diverging bar: A's wins grow left of the midline, B's right,
// draws as a neutral block in the middle. The canonical encoding for a duel — and
// an even record is unmistakable because the fill stops at the tick.
function duelBar(aWins: number, bWins: number, draws: number, aTint: RGB, bTint: RGB, width: number): Node {
  return FrameBuffer({
    width,
    height: 1,
    draw: (surf, box) => {
      for (let i = 0; i < box.w; i++) surf.setCell(box.x + i, box.y, '·', TRACK, CARD_BG);
      const { mid, aCells, bCells, drawCells } = duelArms(aWins, bWins, draws, box.w);
      const dLeft = Math.floor(drawCells / 2);
      // A grows leftward from the draw block, B rightward, draws straddle the midpoint.
      for (let i = 0; i < aCells; i++) {
        const x = mid - dLeft - 1 - i;
        if (x >= 0) surf.setCell(box.x + x, box.y, '█', aTint, CARD_BG);
      }
      for (let i = 0; i < drawCells; i++) {
        const x = mid - dLeft + i;
        if (x >= 0 && x < box.w) surf.setCell(box.x + x, box.y, '▓', EVEN_GRAY, CARD_BG);
      }
      for (let i = 0; i < bCells; i++) {
        const x = mid + (drawCells - dLeft) + i;
        if (x < box.w) surf.setCell(box.x + x, box.y, '█', bTint, CARD_BG);
      }
      if (drawCells === 0) surf.setCell(box.x + mid, box.y, '│', [96, 100, 120], CARD_BG);
    },
  });
}

function h2hView(regionW: number): Node {
  const a = h2hA;
  const b = h2hB;
  const rec = dummyHeadToHead(a, b, game);
  const aT = tintOf(a);
  const bT = tintOf(b);
  const panelW = panelWidth(regionW, H2H_PANEL_W);
  const inner = panelW - 6;
  const body: Node[] = rec
    ? [
        // Direct labels in each model's own tint — no legend, and it names which
        // wisp is which (the tints alone cannot be trusted to do that).
        Box({ flexDirection: 'row', justifyContent: 'between' }, [
          Text({ text: fit(shortModel(a), 24), style: { color: aT, bold: true } }),
          Text({ text: fit(shortModel(b), 24), style: { color: bT, bold: true } }),
        ]),
        Box({ flexDirection: 'row', justifyContent: 'between' }, [Text({ text: `${rec.aWins} wins`, style: { color: INK } }), Text({ text: `${rec.bWins} wins`, style: { color: INK } })]),
        Box({ height: 1 }),
        duelBar(rec.aWins, rec.bWins, rec.draws, aT, bT, inner),
        Box({ flexDirection: 'row', justifyContent: 'center' }, [Text({ text: `${rec.total} games${game === 'chess' ? ` · ${rec.draws} drawn` : ''}`, style: { color: INK_DIM } })]),
        Box({ height: 1 }),
        rule(inner),
        Box({ height: 1 }),
        rowBox([Text({ text: 'edge', style: { color: INK_DIM, width: 10 } }), Text({ text: edgeLabel(rec.aWins, rec.bWins, a, b), style: { color: rec.aWins === rec.bWins ? EVEN_GRAY : rec.aWins > rec.bWins ? aT : bT } })]),
        rowBox([Text({ text: 'sample', style: { color: INK_DIM, width: 10 } }), Text({ text: rec.total < THIN_SAMPLE ? `${rec.total} games — indicative only` : `${rec.total} games`, style: { color: rec.total < THIN_SAMPLE ? INK_DIM : INK } })]),
      ]
    : [Text({ text: 'click a wisp to pick a model.', style: { color: INK_DIM } })];
  const left = Box({ flexDirection: 'column', width: panelW, padding: [1, 2], background: SCRIM, alignItems: 'stretch' }, [
    Text({ text: `${game.toUpperCase()} · HEAD-TO-HEAD`, style: { color: 'accent', bold: true } }),
    Box({ height: 1 }),
    ...body,
  ]);
  // The right region is transparent — the two models' wisps (LeaderboardScene) show
  // through it side by side. Clicking a wisp opens the shared model-swap modal (main.ts).
  // The wisps split symmetrically about that region's center, so a two-column label
  // row along its bottom sits under the right orb: direct labeling, because the tints
  // alone can't be trusted to say which wisp is which.
  const label = (slug: string, tint: RGB): Node =>
    Box({ flexDirection: 'column', flexGrow: 1, alignItems: 'center' }, [Text({ text: fit(shortModel(slug), 26), style: { color: tint, bold: true } }), Text({ text: 'click wisp to swap', style: { color: INK_DIM } })]);
  const wispLabels = Box({ flexDirection: 'column', flexGrow: 1, alignItems: 'stretch', justifyContent: 'end', padding: [0, 0, 2, 0] }, [
    Box({ flexDirection: 'row', alignItems: 'start' }, [label(a, aT), label(b, bT)]),
  ]);
  // The row stretches so the label column can push its content to the bottom; the
  // record panel hugs its own content via a spacer beneath it, instead of becoming a
  // tall empty slab (the standings list is the only panel that should fill height).
  return Box({ flexDirection: 'row', gap: BODY_GAP, alignItems: 'stretch', flexGrow: 1 }, [Box({ flexDirection: 'column', width: panelW }, [left, Box({ flexGrow: 1 })]), wispLabels]);
}

function edgeLabel(aWins: number, bWins: number, a: string, b: string): string {
  if (aWins === bWins) return 'even';
  const lead = aWins > bWins ? a : b;
  return `${fit(shortModel(lead), 20)} +${Math.abs(aWins - bWins)}`;
}

// ---- matrix ----

const MATRIX_N = 12;
const MATRIX_LABEL_W = 24;
const MATRIX_CELL_W = 3; // 2 cells of fill + 1 of surface gap

// Diverging steps per arm, near-even → decisive. Each arm validated as an ordinal
// ramp against this surface (monotone lightness, ΔL ≥ 0.06, single hue).
//
// Cells are drawn with '▄' (lower half) rather than '▀': the 8x8 font's ink sits in
// the lower two thirds of a cell, so a lower-half block lines up with its row label
// while the gap lands above it. An upper-half block reads as the row above's cell.
const WIN_STEPS: RGB[] = [
  [53, 98, 150],
  [74, 144, 217],
  [122, 180, 232],
];
const LOSS_STEPS: RGB[] = [
  [131, 58, 58],
  [192, 75, 75],
  [232, 133, 133],
];

// Who-beats-whom. Hue carries the SIGN (blue = row wins, red = row loses) and
// lightness the MAGNITUDE. Cells are drawn as '▀' — a top-half block over the panel
// background — so every cell has a gap beneath it and the grid reads as discrete
// cells instead of continuous vertical stripes. Pairings under 5 games are blanked.
function matrixCell(rowModel: string, colModel: string, self: boolean): Node {
  const rec = self ? null : dummyHeadToHead(rowModel, colModel, game);
  const thin = !rec || rec.total < 5;
  return FrameBuffer({
    width: MATRIX_CELL_W,
    height: 1,
    draw: (surf, box) => {
      if (self) return; // the diagonal stays empty — an unfilled cell reads as "self"
      if (thin || !rec) {
        surf.setCell(box.x, box.y, '·', RULE, CARD_BG);
        return;
      }
      const decided = rec.total - rec.draws;
      const bin = divergingBin(decided > 0 ? rec.aWins / decided : 0.5);
      const color = bin.sign === 'win' ? WIN_STEPS[bin.step] : bin.sign === 'loss' ? LOSS_STEPS[bin.step] : EVEN_GRAY;
      surf.setCell(box.x, box.y, '▄', color, CARD_BG);
      surf.setCell(box.x + 1, box.y, '▄', color, CARD_BG);
    },
  });
}

function swatch(label: string, steps: RGB[]): Node {
  return Box({ flexDirection: 'row', gap: 1 }, [Box({ flexDirection: 'row' }, steps.map((c) => Text({ text: '▄▄', style: { color: c } }))), Text({ text: label, style: { color: INK_DIM } })]);
}

function matrixView(data: LeaderboardData): Node {
  const rows = standings(data).slice(0, MATRIX_N);
  const models = rows.map((r) => r.model);
  // Column labels are the row numbers: 2-char name truncations collide ("gp" three
  // times over), so the row list beside the grid is the only usable key.
  const header = rowBox([
    cell('', MATRIX_LABEL_W, INK_DIM),
    ...models.map((_, i) => Text({ text: String(i + 1).padStart(2), style: { color: INK_DIM, width: MATRIX_CELL_W } })),
  ]);
  const grid = models.map((rowModel, ri) =>
    rowBox([
      Box({ flexDirection: 'row', gap: 1, width: MATRIX_LABEL_W }, [
        Text({ text: String(ri + 1).padStart(2), style: { color: INK_DIM } }),
        Text({ text: '▌', style: { color: tintOf(rowModel) } }),
        Text({ text: fit(shortModel(rowModel), MATRIX_LABEL_W - 6), style: { color: ri < 3 ? INK : INK_DIM } }),
      ]),
      ...models.map((colModel, ci) => matrixCell(rowModel, colModel, ri === ci)),
    ]),
  );
  const legend = Box({ flexDirection: 'row', gap: 3 }, [
    swatch('row loses', [...LOSS_STEPS].reverse()),
    Box({ flexDirection: 'row', gap: 1 }, [Text({ text: '▄▄', style: { color: EVEN_GRAY } }), Text({ text: 'even', style: { color: INK_DIM } })]),
    swatch('row wins', WIN_STEPS),
    Text({ text: '·  under 5 games', style: { color: INK_DIM } }),
  ]);
  const panel = Box({ flexDirection: 'column', padding: [1, 2], background: SCRIM, alignItems: 'stretch' }, [
    Text({ text: `${game.toUpperCase()} · WHO BEATS WHOM · top ${MATRIX_N}`, style: { color: 'accent', bold: true } }),
    Text({ text: 'row vs column · decided games only', style: { color: INK_DIM } }),
    Box({ height: 1 }),
    header,
    rule(MATRIX_LABEL_W + models.length * (MATRIX_CELL_W + 1)),
    ...grid,
    Box({ height: 1 }),
    legend,
  ]);
  const t = data.totals;
  const totals = Box({ flexDirection: 'column', padding: [1, 2], background: CARD, border: 'round', borderColor: RULE, width: 30 }, [
    Text({ text: 'TOTALS', style: { color: 'accent', bold: true } }),
    Box({ height: 1 }),
    rowBox([cell('models', 15, INK_DIM), cell(String(t.modelsRanked), 10)]),
    rowBox([cell('games', 15, INK_DIM), cell(t.gamesRecorded.toLocaleString(), 10)]),
    rowBox([cell('last game', 15, INK_DIM), cell(t.lastGame, 10)]),
    Box({ height: 1 }),
    Text({ text: 'ACTIVITY · 30d', style: { color: INK_DIM } }),
    activityStrip(24, data),
  ]);
  // Matrix reserves no scene region, so it owns the whole frame — center the block
  // rather than leaving it stranded against the top-left corner.
  return Box({ flexDirection: 'column', flexGrow: 1, justifyContent: 'center', alignItems: 'center' }, [Box({ flexDirection: 'row', gap: 2, alignItems: 'start' }, [panel, totals])]);
}

// Activity demoted to a thin sparkline: it's context for the totals, not a metric
// worth its own screen. Eighth-blocks give 8 steps of height in one cell row.
function activityStrip(width: number, data: LeaderboardData): Node {
  return FrameBuffer({
    width,
    height: 2,
    draw: (surf, box) => {
      const pts = data.activity.slice(-box.w);
      const max = Math.max(1, ...pts.map((p) => p.chess + p.poker));
      const ramp = ' ▁▂▃▄▅▆▇█';
      pts.forEach((p, i) => {
        const t = (p.chess + p.poker) / max;
        const idx = Math.max(1, Math.round(t * 8));
        surf.setCell(box.x + i, box.y + 1, ramp[idx], [112, 122, 188], CARD_BG);
      });
    },
  });
}

// ---- root ----

export function buildLeaderboard(region: LayoutBox, onMenu: () => void): Node {
  // The list fills the panel exactly, so its last row IS the panel's bottom row. The
  // budget: root pad (1 top + 1 bottom) + tab strip (2) + body gap (1) + the panel's own
  // top pad (1) + title (1) + spacer (1) + legend (1) + header rule pair (2). Any slack
  // here shows up as a strip of dead scrim under the scrollbar.
  const listH = Math.max(6, region.h - 11);
  const body: Node = !current
    ? Box({ flexGrow: 1, justifyContent: 'center', alignItems: 'center' }, [Text({ text: 'loading…', style: { color: INK_DIM } })])
    : metric === 'standings'
      ? standingsView(current, listH, region.w)
      : metric === 'headtohead'
        ? h2hView(region.w)
        : matrixView(current);

  // Transparent root: the left panels are dark scrims; the right region shows the
  // LeaderboardScene wisp(s) through. Nav lives in the top-right ☰ menu (no bottom bar).
  return Box({ width: region.w, height: region.h, flexDirection: 'column', alignItems: 'stretch', padding: [1, ROOT_PAD_X], gap: 1 }, [controls(onMenu), body]);
}
