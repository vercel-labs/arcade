// The leaderboard screen: ONE metric at a time, chosen with clickable tabs.
//   • Win Rate     — ranked list (left, fills to the bottom) + a creator filter
//                    (top-right) + the #1 model's wisp (right, in the scene).
//   • Head-to-Head — two searchable model dropdowns + their record (left) + both
//                    models' wisps (right, in the scene).
//   • Activity     — the activity graph + totals (game-agnostic).
// Everything is mouse-clickable and reuses the shared TUI components. The left is
// opaque cards; the right region is transparent so LeaderboardScene's creator
// wisp(s) show through (which creators is decided by activeWispCreators()).

import type { RGB } from '../../engine/index.ts';
import { Box, Button, Dropdown, FrameBuffer, ScrollBox, Slot, Text, type LayoutBox, type Node, type Screen, type Style } from '../../tui/index.ts';
import { UI_CHROME_PILL } from '../theme.ts';
import { dummyHeadToHead, leaderboardCreators, modelsForGame, type ChessRow, type LeaderGame, type LeaderboardData, type PokerRow } from './data.ts';

export type Metric = 'winrate' | 'headtohead' | 'activity';

const GOOD: RGB = [120, 190, 120];
const BAD: RGB = [220, 110, 110];
const CHESS_BLUE: RGB = [110, 140, 220];
const POKER_GREEN: RGB = [120, 190, 120];
const PANEL: [number, number, number, number] = [16, 18, 26, 0.96];
const PLATE: [number, number, number, number] = [16, 18, 26, 0.72];
const ALL = 'all creators';

let metric: Metric = 'winrate';
let game: LeaderGame = 'chess';
let current: LeaderboardData | null = null;
let screen: Screen | null = null;

const winList = new ScrollBox({ id: 'lb-winlist', width: 84, height: 20, rows: [] });
const creatorDrop = new Dropdown({ id: 'lb-creator', items: [ALL], width: 22, rows: 12, searchable: true, searchPlaceholder: 'filter creator…', index: 0 });
const modelA = new Dropdown({ id: 'lb-model-a', items: [], width: 30, rows: 8, searchable: true, searchPlaceholder: 'search model…' });
const modelB = new Dropdown({ id: 'lb-model-b', items: [], width: 30, rows: 8, searchable: true, searchPlaceholder: 'search model…' });

export function mountLeaderboard(ui: Screen): void {
  screen = ui;
  ui.mount(winList);
  ui.mount(creatorDrop);
  ui.mount(modelA);
  ui.mount(modelB);
}

// Open + focus a head-to-head model dropdown — clicking a wisp's name-plate does
// this, so you can change the compared model by wisp or by the dropdown itself.
function openModelDropdown(which: 'a' | 'b'): void {
  const d = which === 'a' ? modelA : modelB;
  d.open = true;
  screen?.setFocus(d.id);
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
  winList.scroll = 0;
  refillModels();
}

function refillModels(): void {
  const ms = current ? modelsForGame(current, game) : [];
  modelA.setItems(ms, ms.length > 0 ? 0 : -1);
  modelB.setItems(ms, ms.length > 1 ? 1 : -1);
}

function shortModel(slug: string): string {
  const slash = slug.lastIndexOf('/');
  return slash === -1 ? slug : slug.slice(slash + 1);
}
function creatorOf(slug: string): string {
  return slug.split('/')[0] ?? slug;
}
// Text cells reserve width but don't clip, so long names must be truncated to
// avoid spilling into the next column.
function fit(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}
function cell(text: string, width: number, color: RGB | string = 'fg'): Node {
  return Text({ text, style: { width, color } });
}
function rowBox(cells: Node[]): Node {
  return Box({ flexDirection: 'row', gap: 1 }, cells);
}
// A ranked row; if the model name exceeds its column it wraps onto a second line
// (the name continuation sits under the name column) while the stats stay on line 1.
function wrapRow(rank: Node, name: string, rankW: number, nameW: number, stats: Node[]): Node {
  if (name.length <= nameW) return rowBox([rank, cell(name, nameW), ...stats]);
  return Box({ flexDirection: 'column' }, [rowBox([rank, cell(name.slice(0, nameW), nameW), ...stats]), rowBox([cell('', rankW), cell(name.slice(nameW), nameW)])]);
}
function rateColor(v: number): RGB | string {
  if (v >= 0.55) return GOOD;
  if (v < 0.45) return BAD;
  return 'fg';
}
function panel(children: Node[], style: Partial<Style> = {}): Node {
  return Box({ flexDirection: 'column', padding: [1, 2], background: PANEL, gap: 0, ...style }, children);
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

// Which creators the wisp scene should show for the current metric/selection.
export function activeWispCreators(): string[] {
  if (!current) return [];
  if (metric === 'winrate') {
    const rows = game === 'chess' ? filteredChess(current) : filteredPoker(current);
    return rows[0] ? [creatorOf(rows[0].model)] : [];
  }
  if (metric === 'headtohead') {
    return [modelA.value, modelB.value].filter((m): m is string => !!m).map(creatorOf);
  }
  return [];
}

// ---- top controls: metric tabs + game pills (+ creator filter, win-rate only) ----

function pill(id: string, label: string, on: boolean, onClick: () => void): Node {
  return Button({
    id,
    label,
    onClick,
    style: {
      padding: [0, 2],
      background: on ? ([112, 122, 188] as RGB) : ([44, 46, 56] as RGB),
      color: on ? ([16, 16, 24] as RGB) : ([200, 204, 216] as RGB),
      bold: on,
      hover: { background: [238, 240, 248] as RGB, color: [16, 16, 24] as RGB },
    },
  });
}

function controls(onMenu: () => void): Node {
  const left = Box({ flexDirection: 'row', alignItems: 'center', gap: 1 }, [
    Text({ text: 'LEADERBOARD ', style: { color: 'accent', bold: true } }),
    pill('lb-tab-winrate', 'win rate', metric === 'winrate', () => setMetric('winrate')),
    pill('lb-tab-h2h', 'head-to-head', metric === 'headtohead', () => setMetric('headtohead')),
    pill('lb-tab-activity', 'activity', metric === 'activity', () => setMetric('activity')),
    ...(metric === 'activity'
      ? []
      : [Text({ text: '  game ', style: { color: 'muted' } }), pill('lb-game-chess', 'chess', game === 'chess', () => setGame('chess')), pill('lb-game-poker', 'poker', game === 'poker', () => setGame('poker'))]),
  ]);
  // ☰ menu (home / controls / account / telemetry / quit) top-right, like the other screens.
  const menuBtn = Button({ id: 'lb-menu-button', label: '☰ menu', onClick: onMenu, style: UI_CHROME_PILL });
  return Box({ flexDirection: 'row', alignItems: 'center', justifyContent: 'between' }, [left, menuBtn]);
}

// ---- name-plate labels over the (transparent) wisp region ----

function plate(lines: string[]): Node {
  return Box({ flexDirection: 'column', alignItems: 'center', padding: [0, 2], background: PLATE }, lines.map((l, i) => Text({ text: l, style: { color: i === 0 ? 'fg' : 'muted', bold: i === 0 } })));
}
function oneWispRegion(lines: string[]): Node {
  return Box({ flexGrow: 1, justifyContent: 'center', alignItems: 'center' }, [plate(lines)]);
}

// ---- win-rate view ----

const CHESS_COLS: [number, number, number, number, number, number, number] = [6, 34, 5, 4, 4, 4, 8];
function chessHeader(): Node {
  const [r, m, g, w, l, d, wr] = CHESS_COLS;
  return rowBox([cell('RANK', r, 'muted'), cell('MODEL', m, 'muted'), cell('GP', g, 'muted'), cell('W', w, 'muted'), cell('L', l, 'muted'), cell('D', d, 'muted'), cell('WIN%', wr, 'muted')]);
}
function chessRows(rows: ChessRow[]): Node[] {
  const [r, m, g, w, l, d, wr] = CHESS_COLS;
  return rows.map((row, i) => {
    const rank = cell(`${i === 0 ? '▸' : ' '} ${String(i + 1).padStart(2)}`, r, i === 0 ? 'accent' : 'muted');
    const stats = [
      cell(String(row.games).padStart(3), g, 'muted'),
      cell(String(row.wins).padStart(2), w),
      cell(String(row.losses).padStart(2), l),
      cell(String(row.draws).padStart(2), d),
      cell(pct(row.winRate).padStart(6), wr, rateColor(row.winRate)),
    ];
    return wrapRow(rank, shortModel(row.model), r, m, stats);
  });
}
const POKER_COLS: [number, number, number, number, number, number, number] = [6, 34, 6, 4, 4, 8, 11];
function pokerHeader(): Node {
  const [r, m, h, w, l, wr, nc] = POKER_COLS;
  return rowBox([cell('RANK', r, 'muted'), cell('MODEL', m, 'muted'), cell('HANDS', h, 'muted'), cell('W', w, 'muted'), cell('L', l, 'muted'), cell('WIN%', wr, 'muted'), cell('NET CHIPS', nc, 'muted')]);
}
function pokerRows(rows: PokerRow[]): Node[] {
  const [r, m, h, w, l, wr, nc] = POKER_COLS;
  return rows.map((row, i) => {
    const winRate = row.hands > 0 ? row.wins / row.hands : 0;
    const net = `${row.netChips >= 0 ? '+' : '-'}${Math.abs(row.netChips).toLocaleString()}`;
    const rank = cell(`${i === 0 ? '▸' : ' '} ${String(i + 1).padStart(2)}`, r, i === 0 ? 'accent' : 'muted');
    const stats = [
      cell(String(row.hands).padStart(4), h, 'muted'),
      cell(String(row.wins).padStart(2), w),
      cell(String(row.losses).padStart(2), l),
      cell(pct(winRate).padStart(6), wr, rateColor(winRate)),
      cell(net.padStart(9), nc, row.netChips >= 0 ? GOOD : BAD),
    ];
    return wrapRow(rank, shortModel(row.model), r, m, stats);
  });
}

function winRateView(data: LeaderboardData, listH: number): Node {
  winList.setHeight(listH);
  let header: Node;
  let top: ChessRow | PokerRow | undefined;
  let topLines: string[];
  if (game === 'chess') {
    const rows = filteredChess(data);
    winList.rows = chessRows(rows);
    header = chessHeader();
    top = rows[0];
    topLines = top ? [shortModel(top.model), creatorOf(top.model), `win rate ${pct((top as ChessRow).winRate)}`] : ['no models'];
  } else {
    const rows = filteredPoker(data);
    winList.rows = pokerRows(rows);
    header = pokerHeader();
    top = rows[0];
    topLines = top ? [shortModel(top.model), creatorOf(top.model), `net ${(top as PokerRow).netChips >= 0 ? '+' : '-'}${Math.abs((top as PokerRow).netChips).toLocaleString()}`] : ['no models'];
  }
  // Title row with the creator filter baked into the panel's top-right corner. The
  // right pad reserves the scrollbar's column so the selector lines up with the list.
  const title = Box({ flexDirection: 'row', alignItems: 'center', justifyContent: 'between', padding: [0, 1, 0, 0] }, [
    Text({ text: `${game.toUpperCase()} · win rate`, style: { color: 'accent', bold: true } }),
    Box({ flexDirection: 'row', alignItems: 'center', gap: 1 }, [Text({ text: 'creator', style: { color: 'muted' } }), Slot('lb-creator')]),
  ]);
  // Right padding 0 so the list's scrollbar sits flush against the panel's right edge.
  const left = panel([title, Box({ height: 1 }), header, Slot('lb-winlist')], { width: 86, padding: [1, 0, 1, 2], alignItems: 'stretch' });
  const right = top ? oneWispRegion(['#1 model', ...topLines]) : Box({ flexGrow: 1 });
  return Box({ flexDirection: 'row', gap: 2, alignItems: 'stretch', flexGrow: 1 }, [left, right]);
}

// ---- head-to-head view ----

function h2hView(data: LeaderboardData): Node {
  const a = modelA.value ?? '';
  const b = modelB.value ?? '';
  const rec = dummyHeadToHead(a, b, game);
  const recCard = panel(
    [
      Text({ text: `${game.toUpperCase()} · head-to-head`, style: { color: 'accent', bold: true } }),
      Box({ height: 1 }),
      ...(rec
        ? [
            rowBox([cell('games played', 20, 'muted'), cell(String(rec.total), 6)]),
            rowBox([cell(fit(shortModel(a), 24), 26), cell(`${rec.aWins} wins`, 10, rec.aWins >= rec.bWins ? GOOD : 'fg')]),
            rowBox([cell(fit(shortModel(b), 24), 26), cell(`${rec.bWins} wins`, 10, rec.bWins > rec.aWins ? GOOD : 'fg')]),
            ...(game === 'chess' ? [rowBox([cell('draws', 20, 'muted'), cell(String(rec.draws), 6)])] : []),
          ]
        : [Text({ text: 'pick two models to compare — click a wisp or its dropdown.', style: { color: 'muted' } })]),
    ],
    { width: 46 },
  );
  // Each wisp is directly clickable (opens its model dropdown below it) — like
  // clicking a player's wisp to swap models in a game. The dropdown is also
  // usable directly, and shows the current model name.
  const wispCol = (which: 'a' | 'b', id: string): Node =>
    Box({ flexGrow: 1, flexDirection: 'column', alignItems: 'center', gap: 1 }, [
      { ...Box({ flexGrow: 3, hover: { background: [50, 54, 74, 0.4] } }), focusable: true, onClick: () => openModelDropdown(which) },
      Slot(id),
      Box({ flexGrow: 2 }),
    ]);
  const right = Box({ flexGrow: 1, flexDirection: 'row', gap: 2, alignItems: 'stretch' }, [wispCol('a', 'lb-model-a'), wispCol('b', 'lb-model-b')]);
  return Box({ flexDirection: 'row', gap: 2, alignItems: 'stretch', flexGrow: 1 }, [recCard, right]);
}

// ---- activity view ----

function activityStrip(width: number): Node {
  const H = 8;
  return FrameBuffer({
    width,
    height: H,
    draw: (surf, box) => {
      const pts = current?.activity ?? [];
      const n = Math.min(pts.length, box.w);
      const slice = pts.slice(pts.length - n);
      const max = Math.max(1, ...slice.map((p) => p.chess + p.poker));
      slice.forEach((p, i) => {
        const x = box.x + i;
        const chessH = Math.round((p.chess / max) * box.h);
        const pokerH = Math.round((p.poker / max) * box.h);
        let y = box.y + box.h - 1;
        for (let c = 0; c < chessH && y >= box.y; c++, y--) surf.setCell(x, y, '█', CHESS_BLUE, [0, 0, 0]);
        for (let c = 0; c < pokerH && y >= box.y; c++, y--) surf.setCell(x, y, '█', POKER_GREEN, [0, 0, 0]);
      });
    },
  });
}
function activityView(data: LeaderboardData): Node {
  const t = data.totals;
  const line = (label: string, value: string): Node => rowBox([cell(label, 16, 'muted'), cell(value, 12, 'fg')]);
  const totals = panel([Text({ text: 'TOTALS', style: { color: 'accent', bold: true } }), Box({ height: 1 }), line('models ranked', String(t.modelsRanked)), line('games recorded', String(t.gamesRecorded)), line('last game', t.lastGame)], { width: 34 });
  const graph = panel([Text({ text: 'ACTIVITY · games per day · 30d', style: { color: 'accent', bold: true } }), Box({ height: 1 }), Box({ flexDirection: 'row', gap: 2 }, [Text({ text: '█ chess', style: { color: CHESS_BLUE } }), Text({ text: '█ poker', style: { color: POKER_GREEN } })]), Box({ height: 1 }), activityStrip(72)], { flexGrow: 1 });
  return Box({ flexDirection: 'row', gap: 2, alignItems: 'start', flexGrow: 1 }, [graph, totals]);
}

// ---- root ----

export function buildLeaderboard(region: LayoutBox, onMenu: () => void): Node {
  const listH = Math.max(6, region.h - 9); // fill toward the bottom (no bottom bar), leaving margin
  const body: Node = !current
    ? Box({ flexGrow: 1, justifyContent: 'center', alignItems: 'center' }, [Text({ text: 'loading…', style: { color: 'muted' } })])
    : metric === 'winrate'
      ? winRateView(current, listH)
      : metric === 'headtohead'
        ? h2hView(current)
        : activityView(current);

  // Transparent root: the left panels are opaque cards; the right region shows the
  // LeaderboardScene wisp(s) through. Nav lives in the top-right ☰ menu (no bottom bar).
  return Box({ width: region.w, height: region.h, flexDirection: 'column', alignItems: 'stretch', padding: [1, 3], gap: 1 }, [controls(onMenu), body]);
}
