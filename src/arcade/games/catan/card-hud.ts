// The Catan card-UI workbench. It accepts a viewer-safe snapshot and renders the local hand plus
// a toggleable sidebar holding the action history, the public bank supply, and player summaries.
// The seeded snapshot lets the "Board + cards" test mode evolve before a live CatanState is
// attached; gameplay wiring should later replace only the data source, not the card or rail layout.

import { Box, type LayoutBox, type Node, type Row, ScrollBox, type Screen, Slot, Text } from '../../../tui/index.ts';
import { stringWidth } from '../../../engine/index.ts';
import { RAIL_HEADER_H, RAIL_MUTED_FG, RAIL_PAD_L, RAIL_PAD_R, RAIL_PAD_V, RAIL_TEXT_FG, RailPanel } from '../../shell/rail-panel.ts';
import { uiChromeBg } from '../../theme.ts';
import type { PlayerColor, Resource } from '../../../rules/catan/types.ts';

type Rgb = [number, number, number];

interface ResourceLook {
  emoji: string;
  name: string;
  fill: Rgb;
  ink: Rgb;
}

// Only use codepoints whose Unicode Emoji_Presentation is Yes. One with Emoji_Presentation=No
// (🛠️ 🛡️ 🏘️ ⚔️ …) is a TEXT glyph that a trailing U+FE0F promotes to an emoji: terminals honour
// the selector when DRAWING but keep advancing the one-cell text width, because their width
// tables key off the base codepoint. The renderer then reserves two cells for something that
// advances one, every later cell on the row lands a column early, the row's last cells are never
// written, and the diff cannot repair it — it compares the model against itself. That debris is
// what survived until a resize. `pnpm exec tsx src/tools/glyph-width.ts` shows which glyphs are
// safe in a given terminal.
const DEV_CARD_ICON = '🔨';
const KNIGHT_ICON = '💂';
const ROAD_ICON = '➖';
const SETTLEMENT_ICON = '🏠';

// ── Card face: the per-card colors ──────────────────────────────────────────────────────────
// `fill` is the flat background; `ink` colors the name under the glyph. Emoji keep their own
// colors in most terminals, so a fill only reads as a backdrop when its luminance is far from the
// glyph's — the tree, brick, and wheat icons all sit mid-tone in their own hue, so those fills
// stay on-hue but move well away in brightness. Fills must also stay dark enough for the white
// count, and every ink far enough from its fill for the name to hold up at one cell tall.
// `name` is the table name players use, not the rules-engine key (wool -> sheep, grain -> wheat).
const RESOURCE_ORDER: Resource[] = ['lumber', 'brick', 'wool', 'grain', 'ore'];
const RESOURCE_LOOK: Record<Resource, ResourceLook> = {
  lumber: { emoji: '🌲', name: 'wood', fill: [91, 181, 99], ink: [19, 65, 27] },
  brick: { emoji: '🧱', name: 'brick', fill: [168, 70, 52], ink: [255, 236, 226] },
  wool: { emoji: '🐑', name: 'sheep', fill: [148, 196, 79], ink: [27, 48, 22] },
  grain: { emoji: '🌾', name: 'wheat', fill: [201, 160, 8], ink: [66, 48, 4] },
  ore: { emoji: '🪨', name: 'ore', fill: [135, 167, 161], ink: [26, 44, 42] },
};
const DEV_LOOK: ResourceLook = { emoji: DEV_CARD_ICON, name: 'dev', fill: [125, 86, 167], ink: [250, 245, 255] };
const COUNT_INK: Rgb = [250, 252, 255];

// ── Card geometry: the shared shape every card is stamped from ──────────────────────────────
// Width is set by the longest name (brick/sheep/wheat at five cells) plus a column of padding on
// each side; an odd width is what lets those odd-length names center exactly. Glyph, name, and
// count are each positioned absolutely against the card's edges, so any one can be nudged without
// disturbing the others or the card's footprint.
const CARD_W = 7;
// Four rows: count, glyph, name, and one row of air under the name. The glyph sits directly
// beneath the count with no gap — at terminal cell aspect that pair still reads as portrait, and
// the row it used to cost was dead space on every card.
const CARD_H = 4;
const CARD_H_COMPACT = 4;
const EMOJI_LEFT = 2; // glyph's left column inside the card (it occupies this column and the next)
const COUNT_RIGHT = 1; // count's gap from the card's right edge

// ── Hand panel spacing ──────────────────────────────────────────────────────────────────────
const HAND_TITLE_GAP = 1; // rows of air between the title and the cards
const HAND_PAD_B = 1; // air between the cards and the panel's bottom edge

// ── Sidebar chrome ──────────────────────────────────────────────────────────────────────────
// The same dark translucent field the mode panel and the chess/poker chat rails use, so the
// overlay reads as one family instead of a parchment sheet pasted over the board.
const RAIL_TEXT = RAIL_TEXT_FG;
const RAIL_MUTED = RAIL_MUTED_FG;
// Six bank cards in one row is what sets the width: the cards, the gaps between them, and a
// column of padding on each side.
const BANK_CARDS = RESOURCE_ORDER.length + 1;
// Exported so the renderer and camera can inset the 3D viewport by exactly this much while the
// rail is open — the rail participates in the layout rather than painting over the scene.
// The panel background runs flush to the terminal edge (RAIL_PAD_R is 0, so no translucent strip
// shows the scene through it); the body carries its own right inset so text is not jammed against
// that edge. Width is set by the one bank row plus all three insets.
const BODY_PAD_R = 2;
export const CATAN_RAIL_W = BANK_CARDS * CARD_W + (BANK_CARDS - 1) + RAIL_PAD_L + RAIL_PAD_R + BODY_PAD_R;
const RAIL_W = CATAN_RAIL_W;
// The panel's full content width. The history ScrollBox spans all of it so its scrollbar lands on
// the panel's last column — flush, the way the chess chat's does. Everything else is inset from
// that edge by BODY_PAD_R so text is not jammed against it.
const CONTENT_W = RAIL_W - RAIL_PAD_L - RAIL_PAD_R;
const RAIL_INNER = CONTENT_W - BODY_PAD_R;
// Rows stop two columns short of the ScrollBox: one for the bar, one blank beside it, so text can
// never sit flush against the bar. Mirrors the chat's SCROLLBAR_W + RIGHT_GAP reservation.
const HISTORY_ROW_W = CONTENT_W - 2;
// The history claims half the panel and keeps it whether or not there are entries to fill it —
// a log that grows into reserved space beats one that shoves the bank and the table down the
// panel as the game runs. On a short terminal there is less than half to give, so it takes
// whatever the fixed sections leave and scrolls the rest.
const HISTORY_SHARE = 0.5;
const HISTORY_MIN_H = 4;

// Every row of the sidebar that is not the history viewport: the panel's insets and header, the
// two section labels, the bank row, the players table, and the gap under each of those.
function sidebarFixedH(playerCount: number): number {
  const rows = 1 /* history label */ + 1 /* bank label */ + CARD_H /* bank row */ + 1 /* players header */ + playerCount;
  const gaps = 4 + playerCount; // one under every body child except the last
  return RAIL_PAD_V * 2 + RAIL_HEADER_H + rows + gaps;
}

function catanHistoryHeight(region: LayoutBox, playerCount: number): number {
  const spare = region.h - sidebarFixedH(playerCount);
  return Math.max(HISTORY_MIN_H, Math.min(Math.floor(region.h * HISTORY_SHARE), spare));
}

// Player colors are font colors here, never fills — a seat's color reads as its name's ink the
// way a model's creator tint does in the chess chat, which is what these become once models sit
// at the table.
const PLAYER_LOOK: Record<PlayerColor, Rgb> = {
  red: [226, 96, 84],
  blue: [104, 148, 235],
  white: [228, 230, 238],
  orange: [232, 148, 62],
};

// Only what an opponent can legitimately see and act on: hand size, unplayed dev cards, knights
// already played, and how long their road actually runs. `longestRoad` is a run length, not a
// count of placed segments — the two differ and it is the run that decides the card.
export interface CatanCardsPlayerView {
  name: string;
  color: PlayerColor;
  publicVp: number;
  resourceCards: number;
  developmentCards: number;
  knights: number;
  longestRoad: number;
  active?: boolean;
}

export interface CatanActionHistoryView {
  actor: string;
  color: PlayerColor;
  message: string;
  resources?: Resource[];
  chat?: boolean;
}

export interface CatanCardsView {
  localPlayer: CatanCardsPlayerView;
  hand: Record<Resource, number>;
  bank: Record<Resource, number>;
  developmentDeck: number;
  opponents: CatanCardsPlayerView[];
  history: CatanActionHistoryView[];
}

// Uneven counts and mixed events exercise count corners, hidden-card summaries, resource icons,
// and chat folded into the same chronological action history. Enough entries to overflow the
// history viewport, so the scrollbar has something to show.
export const CATAN_CARD_WORKBENCH_VIEW: CatanCardsView = {
  localPlayer: { name: 'You', color: 'red', publicVp: 3, resourceCards: 9, developmentCards: 1, knights: 2, longestRoad: 5, active: true },
  hand: { lumber: 2, brick: 1, wool: 3, grain: 2, ore: 1 },
  bank: { lumber: 16, brick: 18, wool: 17, grain: 18, ore: 17 },
  developmentDeck: 25,
  opponents: [
    { name: 'claude-haiku-4.5', color: 'blue', publicVp: 2, resourceCards: 3, developmentCards: 0, knights: 1, longestRoad: 4 },
    { name: 'gpt-5-nano', color: 'orange', publicVp: 2, resourceCards: 2, developmentCards: 1, knights: 0, longestRoad: 10 }, // two digits, to keep the row's widest case covered
    { name: 'gemini-3-flash', color: 'white', publicVp: 4, resourceCards: 6, developmentCards: 2, knights: 3, longestRoad: 6 },
  ],
  history: [
    { actor: 'You', color: 'red', message: `placed a settlement ${SETTLEMENT_ICON}` },
    { actor: 'You', color: 'red', message: `placed a road ${ROAD_ICON}` },
    { actor: 'claude-haiku-4.5', color: 'blue', message: `placed a settlement ${SETTLEMENT_ICON}` },
    { actor: 'claude-haiku-4.5', color: 'blue', message: `placed a road ${ROAD_ICON}` },
    { actor: 'gpt-5-nano', color: 'orange', message: `placed a settlement ${SETTLEMENT_ICON}` },
    { actor: 'gpt-5-nano', color: 'orange', message: 'good luck all', chat: true },
    { actor: 'gemini-3-flash', color: 'white', message: `placed a settlement ${SETTLEMENT_ICON}` },
    { actor: 'gemini-3-flash', color: 'white', message: `placed a road ${ROAD_ICON}` },
    { actor: 'You', color: 'red', message: 'rolled a 9' },
    { actor: 'You', color: 'red', message: 'received', resources: ['grain', 'lumber'] },
    { actor: 'gemini-3-flash', color: 'white', message: 'received', resources: ['ore'] },
    { actor: 'claude-haiku-4.5', color: 'blue', message: 'rolled a 4' },
    { actor: 'claude-haiku-4.5', color: 'blue', message: 'received', resources: ['brick', 'brick'] },
    { actor: 'claude-haiku-4.5', color: 'blue', message: `built a road ${ROAD_ICON}` },
    { actor: 'gpt-5-nano', color: 'orange', message: 'rolled a 7' },
    { actor: 'gpt-5-nano', color: 'orange', message: 'moved the robber to the ore hex' },
    { actor: 'gpt-5-nano', color: 'orange', message: 'stole a card from gemini-3-flash' },
    { actor: 'gemini-3-flash', color: 'white', message: 'rude', chat: true },
    { actor: 'gemini-3-flash', color: 'white', message: 'rolled an 11' },
    { actor: 'You', color: 'red', message: 'received', resources: ['wool'] },
    { actor: 'You', color: 'red', message: 'rolled a 6' },
    { actor: 'You', color: 'red', message: 'received', resources: ['brick', 'grain'] },
    { actor: 'You', color: 'red', message: 'bought a development card' },
    { actor: 'claude-haiku-4.5', color: 'blue', message: 'rolled an 8' },
    { actor: 'claude-haiku-4.5', color: 'blue', message: 'received', resources: ['lumber', 'wool', 'wool'] },
    { actor: 'claude-haiku-4.5', color: 'blue', message: 'anyone need sheep? I have plenty', chat: true },
    { actor: 'gpt-5-nano', color: 'orange', message: 'traded 2 wheat for 1 ore' },
    { actor: 'gpt-5-nano', color: 'orange', message: 'saving for a city', chat: true },
    { actor: 'gemini-3-flash', color: 'white', message: 'rolled a 5' },
    { actor: 'gemini-3-flash', color: 'white', message: 'received', resources: ['ore', 'ore'] },
    { actor: 'gemini-3-flash', color: 'white', message: 'upgraded to a city' },
    { actor: 'You', color: 'red', message: 'rolled a 10' },
    { actor: 'You', color: 'red', message: `built a road ${ROAD_ICON}` },
    { actor: 'claude-haiku-4.5', color: 'blue', message: 'played a knight' },
    { actor: 'claude-haiku-4.5', color: 'blue', message: 'moved the robber to the wheat hex' },
    { actor: 'gpt-5-nano', color: 'orange', message: 'rolled a 3' },
    { actor: 'gpt-5-nano', color: 'orange', message: 'received', resources: ['brick'] },
    { actor: 'gemini-3-flash', color: 'white', message: 'claimed the longest road' },
    { actor: 'gemini-3-flash', color: 'white', message: 'anyone trading wheat?', chat: true },
    { actor: 'You', color: 'red', message: 'your turn — roll to begin' },
  ],
};

// ── Sidebar visibility ──────────────────────────────────────────────────────────────────────
// Module state, like the tile panel's robber flag: the HUD is rebuilt every frame from these.
// Starts collapsed to its reopen pill, the way the poker chat rail does.
let sidebarOpen = false;
export function catanSidebarOpen(): boolean {
  return sidebarOpen;
}
// Whether the rail is actually on screen: open AND the terminal is big enough to draw it. The
// renderer insets the 3D viewport by CATAN_RAIL_W, so it has to ask this rather than the raw flag
// — asking the flag reserves a 51-column strip that nothing paints on a small terminal.
export function catanRailVisible(cols: number, rows: number): boolean {
  return sidebarOpen && catanCardsLayout({ x: 0, y: 0, w: cols, h: rows }).showPublicRail;
}
export function toggleCatanSidebar(): void {
  sidebarOpen = !sidebarOpen;
}

// Exported so callers (and tests) can reach the rows the way the chess HUD exposes its move
// history — the rail's Slot renders it through the component registry, not the node tree.
// The height here is a placeholder: every build resizes the viewport to its share of the
// terminal, which is only knowable once the region is in hand.
const catanHistoryScroll = new ScrollBox({ id: 'catan-history', width: CONTENT_W, height: HISTORY_MIN_H, rows: [] });

export function mountCatanCardsHud(ui: Screen): void {
  ui.mount(catanHistoryScroll);
}

export interface CatanCardsLayout {
  compact: boolean;
  showPublicRail: boolean;
  railWidth: number;
  handHeight: number;
}

// Pure size policy — the sidebar toggle is applied at build time, so this stays a function of the
// region alone.
export function catanCardsLayout(region: LayoutBox): CatanCardsLayout {
  const compact = region.w < 96 || region.h < 34;
  return {
    compact,
    showPublicRail: region.w >= 112 && region.h >= 40,
    railWidth: RAIL_W,
    // Compact is the card slot alone; otherwise a title row and its gap sit above it. Both carry
    // the slot's two reserved peek rows and the panel's bottom pad.
    handHeight: compact ? CARD_H_COMPACT + HAND_PAD_B : 1 + HAND_TITLE_GAP + CARD_H + HAND_PAD_B,
  };
}

// A deliberately flat rectangle like the reference cards: one uninterrupted color field, the
// glyph over its name, and a plain white count in the top-right. No frame.
function card(look: ResourceLook, count: number, height = CARD_H): Node {
  // Glyph and name read as one block, so center the pair rather than each row; the count keeps
  // the top-right corner and overlaps whatever blank space is left above.
  const glyphRow = Math.floor((height - 2) / 2);
  // A name whose length differs in parity from the card width has no exact center: the leftover
  // splits into a half cell per side. The layout's own centering rounds that half to the right,
  // which left `wood` — the one even-length name — visibly shoved toward the card's right edge.
  // Flooring the column instead biases the odd cell left, matching how the names read as a set.
  const nameLeft = Math.floor((CARD_W - look.name.length) / 2);
  return Box({ width: CARD_W, height, position: 'relative', background: look.fill }, [
    Box({ position: 'absolute', top: 0, right: COUNT_RIGHT, width: 2, height: 1, justifyContent: 'center' }, [
      Text({ text: `${count}`, style: { color: COUNT_INK, bold: true } }),
    ]),
    Box({ position: 'absolute', top: glyphRow, left: EMOJI_LEFT, width: 2, height: 1 }, [
      Text({ text: look.emoji, style: { color: look.ink } }),
    ]),
    Box({ position: 'absolute', top: glyphRow + 1, left: nameLeft, width: look.name.length, height: 1 }, [
      Text({ text: look.name, style: { color: look.ink, bold: true } }),
    ]),
  ]);
}

// Just the label — the row gap between sections is the separation, no rule bar.
function sectionTitle(label: string): Node {
  return Text({ text: label, style: { color: RAIL_MUTED, bold: true } });
}

// One history entry, shaped like a chat line: the line opens on the actor, in its seat colour —
// the same shape as a chess/poker chat line, where the coloured name is what identifies the
// speaker. Chat goes muted so table talk sits behind the game events without needing an icon to
// tell them apart.
//
// Every entry has to be exactly one row: the viewport sizes itself in rows and the scroll maths
// counts one per entry, so a wrapped line would desync both. Model slugs run to 16 cells, long
// enough that a slug and a full sentence overflow the rail together — clipping the Box swallowed
// the gap and ran the name into the message. Trimming the body to what is left instead keeps the
// separation and marks the cut.
function historyRow(entry: CatanActionHistoryView): Node {
  const resourceIcons = (entry.resources ?? []).map((resource) => RESOURCE_LOOK[resource].emoji).join(' ');
  const body = clampToWidth(`${entry.message}${resourceIcons ? ` ${resourceIcons}` : ''}`, HISTORY_ROW_W - stringWidth(entry.actor) - 1);
  return Box({ width: HISTORY_ROW_W, gap: 1, overflow: 'hidden' }, [
    Text({ text: entry.actor, style: { color: PLAYER_LOOK[entry.color], bold: true } }),
    Text({ text: body, style: { color: entry.chat ? RAIL_MUTED : RAIL_TEXT } }),
  ]);
}

// Trim to a cell budget, counting emoji as the two cells they occupy and never splitting one.
// The ellipsis costs a cell of its own, so it only earns its place if something was cut.
function clampToWidth(text: string, limit: number): string {
  if (limit <= 0) return '';
  if (stringWidth(text) <= limit) return text;
  let out = '';
  let w = 0;
  for (const ch of text) {
    const cw = stringWidth(ch);
    if (w + cw > limit - 1) break;
    out += ch;
    w += cw;
  }
  return `${out}…`;
}

function bankRow(view: CatanCardsView): Node {
  return Box({ gap: 1 }, [
    ...RESOURCE_ORDER.map((resource) => card(RESOURCE_LOOK[resource], view.bank[resource])),
    card(DEV_LOOK, view.developmentDeck),
  ]);
}

// ── Players table ───────────────────────────────────────────────────────────────────────────
// Model slugs are long enough (claude-haiku-4.5 is 16 cells) that a per-row "2 vp  cards: 3" label
// run no longer fits beside them. The labels move to a header instead and the stats become
// right-aligned columns, which keeps one line per seat, fits the full name, and lets the numbers
// be compared down a column.
// Each column is only as wide as its own header or widest value, so the name column keeps
// everything left over — a uniform width clipped the longest slug by a single cell.
// vp sits at the far right, the column a reader scans to for the standings; the supporting counts
// run from `cards` on the left. `strong` is the score's emphasis, carried on the column rather
// than its position so the order can change without moving the styling with it.
const STAT_GAP = 1;
const STAT_COLUMNS: { head: string; w: number; strong?: boolean; read: (p: CatanCardsPlayerView) => number }[] = [
  { head: 'cards', w: 5, read: (p) => p.resourceCards },
  { head: DEV_CARD_ICON, w: 3, read: (p) => p.developmentCards },
  { head: KNIGHT_ICON, w: 3, read: (p) => p.knights },
  { head: ROAD_ICON, w: 3, read: (p) => p.longestRoad },
  { head: 'vp', w: 2, strong: true, read: (p) => p.publicVp },
];
const NAME_W = RAIL_INNER - STAT_COLUMNS.reduce((n, c) => n + c.w + STAT_GAP, 0);

function statCell(text: string, w: number, color: Rgb, bold = false): Node {
  return Box({ width: w, justifyContent: 'end' }, [Text({ text, style: { color, bold } })]);
}

// The section label doubles as the table's corner cell, so "players" heads the name column the
// way each icon heads its own — one header row instead of a title stacked on top of one.
function playersHeader(): Node {
  return Box({ width: { pct: 100 }, gap: STAT_GAP }, [
    Box({ width: NAME_W }, [sectionTitle('players')]),
    ...STAT_COLUMNS.map((c) => statCell(c.head, c.w, RAIL_MUTED)),
  ]);
}

function playerRow(player: CatanCardsPlayerView): Node {
  const seat = PLAYER_LOOK[player.color];
  return Box({ width: { pct: 100 }, gap: STAT_GAP }, [
    Box({ width: NAME_W, overflow: 'hidden' }, [
      Text({ text: `${player.active ? '▸ ' : '  '}${player.name}`, style: { color: seat, bold: true } }),
    ]),
    // vp is the score, so it keeps the reading white; the rest are supporting detail.
    ...STAT_COLUMNS.map((c) => statCell(`${c.read(player)}`, c.w, c.strong ? RAIL_TEXT : RAIL_MUTED, c.strong)),
  ]);
}

// One continuous dark panel owning the full right strip — the same width the scene viewport is
// inset by, so the rail sits beside the board rather than over it. Its ✕ collapses it back to the
// reopen pill, mirroring the poker chat rail.
function sidebar(view: CatanCardsView, onClose: () => void): Node {
  const players = [...view.opponents, view.localPlayer];
  // Only the ScrollBox reaches the panel edge; the rest is inset so it clears the scrollbar column.
  const inset = (child: Node): Node => Box({ width: { pct: 100 }, padding: [0, BODY_PAD_R, 0, 0] }, [child]);
  const body = Box({ flexDirection: 'column', gap: 1, overflow: 'hidden' }, [
    inset(sectionTitle('action history')),
    Slot('catan-history'),
    inset(sectionTitle('bank')),
    inset(bankRow(view)),
    inset(playersHeader()),
    ...players.map((p) => inset(playerRow(p))),
  ]);
  return Box({ position: 'absolute', top: 0, right: 0, bottom: 0, width: RAIL_W, overflow: 'hidden' }, [
    RailPanel({ width: RAIL_W, height: { pct: 100 }, title: 'sidebar', closeId: 'catan-sidebar-close', onClose }, [body]),
  ]);
}

// Bottom-left corner only: the panel hugs its cards instead of spanning the window, so the board
// stays visible across the rest of the bottom row.
function handPanel(view: CatanCardsView, layout: CatanCardsLayout): Node {
  const cards = RESOURCE_ORDER.map((resource) => card(RESOURCE_LOOK[resource], view.hand[resource], layout.compact ? CARD_H_COMPACT : CARD_H));
  if (layout.compact) {
    return Box({ position: 'absolute', left: 1, bottom: 1, height: layout.handHeight, padding: [0, 1, HAND_PAD_B, 1], background: uiChromeBg(0.9) }, [
      Box({ gap: 1, alignItems: 'center' }, cards),
    ]);
  }
  return Box({ position: 'absolute', left: 1, bottom: 1, height: layout.handHeight, flexDirection: 'column', gap: HAND_TITLE_GAP, padding: [0, 1, HAND_PAD_B, 1], background: uiChromeBg(0.9) }, [
    Text({ text: 'your hand', style: { color: RAIL_TEXT, bold: true } }),
    Box({ gap: 1, alignItems: 'end' }, cards),
  ]);
}

export function buildCatanCardsOverlay(region: LayoutBox, onCloseSidebar: () => void, view: CatanCardsView = CATAN_CARD_WORKBENCH_VIEW): Node {
  const layout = catanCardsLayout(region);
  const showSidebar = sidebarOpen && layout.showPublicRail;
  if (showSidebar) {
    // Follow-to-bottom: stay pinned to the newest entry unless the reader has scrolled up.
    const historyH = catanHistoryHeight(region, view.opponents.length + 1);
    const rows: Row[] = view.history.map(historyRow);
    const atBottom = catanHistoryScroll.scroll >= Math.max(0, catanHistoryScroll.rows.length - historyH);
    catanHistoryScroll.setHeight(historyH);
    catanHistoryScroll.rows = rows;
    const maxScroll = Math.max(0, rows.length - historyH);
    catanHistoryScroll.scroll = atBottom ? maxScroll : Math.min(catanHistoryScroll.scroll, maxScroll);
  }
  return Box({ position: 'absolute', top: 0, left: 0, width: region.w, height: region.h }, [
    ...(showSidebar ? [sidebar(view, onCloseSidebar)] : []),
    handPanel(view, layout),
  ]);
}
