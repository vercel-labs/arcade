// The Catan card-UI workbench. It accepts a viewer-safe snapshot and renders the local hand plus
// a toggleable sidebar holding the action history, the public bank supply, and player summaries.
// The seeded snapshot lets the "Board + cards" test mode evolve before a live CatanState is
// attached; gameplay wiring should later replace only the data source, not the card or rail layout.

import { Box, Button, type LayoutBox, type Node, type PointerHit, type Row, ScrollBox, type Screen, Slot, Text, Tooltip, truncate } from '../../../tui/index.ts';
import { mulberry32, stringWidth } from '../../../engine/index.ts';
import { RAIL_HEADER_H, RAIL_MUTED_FG, RAIL_PAD_L, RAIL_PAD_R, RAIL_PAD_V, RAIL_TEXT_FG, RailPanel } from '../../shell/rail-panel.ts';
import { uiChromeBg } from '../../theme.ts';
import { COSTS, DEV_CARD_TYPES, type DevCardType, DISCARD_LIMIT, type PlayerColor, type Resource, resourceIndex, type Terrain } from '../../../rules/catan/types.ts';
import { buildDevelopmentDeck } from '../../../rules/catan/development.ts';
import {
  CATAN_CARD,
  type CatanCardLook as ResourceLook,
  type CatanRgb as Rgb,
  DEV_CARD_ICON,
  DEV_HAND_LOOK,
  DEV_LOOK,
  KNIGHT_ICON,
  PLAYER_LOOK,
  RESOURCE_LOOK,
  RESOURCE_ORDER,
  ROAD_ICON,
  SETTLEMENT_ICON,
} from './palette.ts';

// Only use codepoints whose Unicode Emoji_Presentation is Yes. One with Emoji_Presentation=No
// (🛠️ 🛡️ 🏘️ ⚔️ …) is a TEXT glyph that a trailing U+FE0F promotes to an emoji: terminals honour
// the selector when DRAWING but keep advancing the one-cell text width, because their width
// tables key off the base codepoint. The renderer then reserves two cells for something that
// advances one, every later cell on the row lands a column early, the row's last cells are never
// written, and the diff cannot repair it — it compares the model against itself. That debris is
// what survived until a resize. `pnpm exec tsx src/tools/glyph-width.ts` shows which glyphs are
// safe in a given terminal.
// ── Card face: the per-card colors ──────────────────────────────────────────────────────────
// `fill` is the flat background; `ink` colors the name under the glyph. Emoji keep their own
// colors in most terminals, so a fill only reads as a backdrop when its luminance is far from the
// glyph's — the tree, brick, and wheat icons all sit mid-tone in their own hue, so those fills
// stay on-hue but move well away in brightness. Every fill also sits in one narrow lightness band
// (~0.35–0.46 relative luminance): that is what lets a dark on-hue ink carry every name while the
// white count still holds on every card. A fill dark enough to need white ink instead — the red
// and the purple, left to their natural depth — reads as a different family sitting in the row.
// `name` is the table name players use, not the rules-engine key (wool -> sheep, grain -> wheat).
const COUNT_INK = CATAN_CARD.countInk;
// A resource you hold none of keeps its card, so the row never reflows as a hand empties and
// refills. The fill drops to a lift off the panel background and the name and count go muted:
// present, plainly spent. The emoji cannot follow — terminals paint it in its own colors and
// ignore the foreground we set — so a zero card keeps a full-color glyph over the gray.
const EMPTY_FILL = CATAN_CARD.emptyFill;
const EMPTY_INK: Rgb = RAIL_MUTED_FG;
// Gold marks a held award; red marks a hand the robber would force a discard from.
const AWARD = CATAN_CARD.award;
const AT_RISK = CATAN_CARD.atRisk;

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
const HAND_PAD_T = 1; // air between the panel's top edge and the card faces
const HAND_PAD_X = 2; // terminal cells are tall, so a wider side inset balances the full-row vertical air
const HAND_PANEL_LEFT = 2; // align the bottom workbench with the top-left control panel
// Wider than the 1-cell gap between cards, so the two hands read as separate groups without
// needing a rule drawn between them.
const HAND_SPLIT_GAP = 3;
// What the fixed resource half of the hand costs, panel padding included. Development cards are
// intrinsic-width: the workbench shows every type, while a real hand shows only types it owns.
const RESOURCE_HAND_W = RESOURCE_ORDER.length * CARD_W + (RESOURCE_ORDER.length - 1) + HAND_PAD_X * 2;
const HAND_PAD_B = 1; // air between the cards and the panel's bottom edge
const HAND_ACTION_W = 9;
const ACTION_W = 12;
// These are intentionally independent. The action pair needs its own seam, and the whole pair
// needs more air from the taller hand tray so their different silhouettes feel deliberate.
const HAND_ACTION_GAP = 2;
const ACTION_BUTTON_GAP = 2;
const ACTIONS_W = HAND_ACTION_W * 2 + ACTION_BUTTON_GAP;
const ACTION_BG = CATAN_CARD.actionBg;
const ACTION_HOVER = CATAN_CARD.actionHover;
const ACTION_DISABLED = CATAN_CARD.actionDisabled;
const ACTION_DISABLED_INK = CATAN_CARD.actionDisabledInk;

interface DevCardHelp {
  title: string;
  effect: string;
}

// Accurate, compact paraphrases of the base-game development cards. The card faces stay terse so
// the hand remains usable in narrow terminals; this copy carries the rules meaning on hover.
const DEV_CARD_HELP: Record<DevCardType, DevCardHelp> = {
  knight: {
    title: 'Knight',
    effect: 'Move the robber to another hex. Then steal 1 random resource from a player with a settlement or city beside its new hex.',
  },
  victoryPoint: {
    title: 'Victory Point',
    effect: 'Keep this card hidden. It is worth 1 victory point; reveal it when it gives you enough points to win.',
  },
  roadBuilding: {
    title: 'Road Building',
    effect: 'Place 2 new roads for free, following the normal road placement rules.',
  },
  yearOfPlenty: {
    title: 'Year of Plenty',
    effect: 'Take any 2 resources from the supply and add them to your hand. They may be the same resource or different resources.',
  },
  monopoly: {
    title: 'Monopoly',
    effect: 'Name 1 resource type. Every other player gives you every resource of that type in their hand.',
  },
};

function devHandWidth(count: number): number {
  return count === 0 ? 0 : HAND_SPLIT_GAP + count * CARD_W + (count - 1);
}

// The expanded editor replaces the compact hand in-place. Bank and hand use the exact same five
// columns, with two fixed transfer rows between them; this preserves the reference's physical
// model of moving cards up out of your hand and down out of the bank. Actions sit in a separate
// rail to the right instead of consuming one of those rows.
const TRADE_ROW_W = RESOURCE_ORDER.length * CARD_W + (RESOURCE_ORDER.length - 1);
const TRADE_TABLE_W = TRADE_ROW_W + 4;
const TRADE_PANEL_W = TRADE_TABLE_W + 1 + ACTION_W;
const TRADE_RATIO = 4;
const TRADE_BG = CATAN_CARD.tradeBg;
const TRADE_ACCENT = CATAN_CARD.tradeAccent;
const TRADE_SLOT_BG = CATAN_CARD.tradeSlotBg;

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
export { PLAYER_LOOK } from './palette.ts';

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
  // Who currently HOLDS each award, which is not the same as who has the highest number: the
  // rules engine only awards past a minimum and the incumbent keeps it on a tie. These come
  // straight from CatanState.largestArmy() / longestRoad() === seat, never recomputed here.
  hasLargestArmy?: boolean;
  hasLongestRoad?: boolean;
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
  // Only the local player's own dev cards; every other seat sees a count, never the types.
  devHand: Record<DevCardType, number>;
  bank: Record<Resource, number>;
  developmentDeck: number;
  opponents: CatanCardsPlayerView[];
  history: CatanActionHistoryView[];
  // TEST BED ONLY. When set, the hand's cards accept click-to-adjust so the card UI can be
  // driven through its states by hand. The game's live adapter leaves it unset, so in a real
  // match the cards are inert and only the rules engine moves them.
  editable?: boolean;
}

// ── The local seat ──────────────────────────────────────────────────────────────────────────
// The test bed has one human at the table and it is red, so the board's red pieces are "yours":
// they are what a roll pays out on. Everything else on the board still belongs to the seeded
// opponents. When a real CatanState is attached this becomes the seat the viewer is bound to.
export const CATAN_LOCAL_COLOR: PlayerColor = 'red';

// The live hand, filled only by dice rolls — building is still free, so nothing spends it yet.
// Module state like the sidebar flag: the HUD is rebuilt from it every frame.
const liveHand: Record<Resource, number> = { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
// The workbench's development hand. Module state for the same reason the resource hand is:
// the view is rebuilt every frame, so anything that has to survive a frame lives out here.
const liveDevHand: Record<DevCardType, number> = { knight: 0, victoryPoint: 0, roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 };
const WORKBENCH_BANK_START: Record<Resource, number> = { lumber: 16, brick: 18, wool: 17, grain: 18, ore: 17 };
const liveBank: Record<Resource, number> = { ...WORKBENCH_BANK_START };
const WORKBENCH_DEV_SEED = 0xc47a_2026;
let liveDevelopmentDeck = buildDevelopmentDeck(mulberry32(WORKBENCH_DEV_SEED));
let workbenchTradeOpen = false;
function emptyResourceCounts(): Record<Resource, number> {
  return { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
}
const workbenchTradeGive = emptyResourceCounts();
const workbenchTradeGet = emptyResourceCounts();

function clearWorkbenchTradeStaging(): void {
  for (const resource of RESOURCE_ORDER) {
    workbenchTradeGive[resource] = 0;
    workbenchTradeGet[resource] = 0;
  }
}

// ── Workbench card editing (catan-test only) ────────────────────────────────────────────────
// Click-to-adjust exists so the card UI can be driven through its states by hand while it is
// being built. It belongs to the TEST BED and must never reach the game, where the rules engine
// is the only thing allowed to move a card — hence `editable` on the view rather than a check
// on some ambient mode: the workbench view opts in, and the live adapter simply does not.
// These write the module state above, NOT the per-frame view object, which is a fresh copy.
export function adjustCatanWorkbenchHand(resource: Resource, delta: number): boolean {
  const next = liveHand[resource] + delta;
  if (next < 0) return false;
  liveHand[resource] = next;
  return true;
}
export function adjustCatanWorkbenchDev(type: DevCardType, delta: number): boolean {
  const next = liveDevHand[type] + delta;
  if (next < 0) return false;
  liveDevHand[type] = next;
  return true;
}

export function catanTradeEditorOpen(): boolean {
  return workbenchTradeOpen;
}

export function setCatanTradeEditorOpen(open: boolean): void {
  workbenchTradeOpen = open;
  if (!open) clearWorkbenchTradeStaging();
}

// Snapshot/test seam. The UI itself reaches this state one card at a time from the two source
// rows; the helper stages a complete standard bank trade for deterministic visual capture.
export function setCatanWorkbenchTradeSelection(give: Resource | null, get: Resource | null): void {
  clearWorkbenchTradeStaging();
  if (give) workbenchTradeGive[give] = TRADE_RATIO;
  if (get) workbenchTradeGet[get] = 1;
}

export function adjustCatanWorkbenchTradeStaging(side: 'give' | 'receive', resource: Resource, delta: number): boolean {
  const staged = side === 'give' ? workbenchTradeGive : workbenchTradeGet;
  const available = side === 'give' ? liveHand[resource] : liveBank[resource];
  const next = staged[resource] + delta;
  if (next < 0 || next > available) return false;
  staged[resource] = next;
  return true;
}

function stagedBankTrade(): { give: Resource; get: Resource } | null {
  const giveResources = RESOURCE_ORDER.filter((resource) => workbenchTradeGive[resource] > 0);
  const getResources = RESOURCE_ORDER.filter((resource) => workbenchTradeGet[resource] > 0);
  if (giveResources.length !== 1 || getResources.length !== 1) return null;
  const give = giveResources[0];
  const get = getResources[0];
  if (give === get || workbenchTradeGive[give] !== TRADE_RATIO || workbenchTradeGet[get] !== 1) return null;
  return { give, get };
}

export function performCatanWorkbenchBankTrade(give: Resource, get: Resource): boolean {
  if (give === get || liveHand[give] < TRADE_RATIO || liveBank[get] < 1) return false;
  liveHand[give] -= TRADE_RATIO;
  liveBank[give] += TRADE_RATIO;
  liveBank[get] -= 1;
  liveHand[get] += 1;
  liveHistory.push({ actor: 'You', color: CATAN_LOCAL_COLOR, message: `traded ${TRADE_RATIO} ${RESOURCE_LOOK[give].name} for 1 ${RESOURCE_LOOK[get].name}` });
  return true;
}

export function performStagedCatanWorkbenchBankTrade(): boolean {
  const trade = stagedBankTrade();
  if (!trade || !performCatanWorkbenchBankTrade(trade.give, trade.get)) return false;
  clearWorkbenchTradeStaging();
  return true;
}

export function buyCatanWorkbenchDevCard(): boolean {
  if (liveDevelopmentDeck.length === 0) return false;
  for (const resource of RESOURCE_ORDER) {
    const amount = COSTS.devCard[resourceIndex(resource)];
    if (liveHand[resource] < amount) return false;
  }
  for (const resource of RESOURCE_ORDER) {
    const amount = COSTS.devCard[resourceIndex(resource)];
    liveHand[resource] -= amount;
    liveBank[resource] += amount;
  }
  // Draw from the same official shuffled deck model as CatanState. The fixed workbench seed keeps
  // snapshots repeatable without turning the deck into an even type rotation.
  const drawn = liveDevelopmentDeck.pop();
  if (!drawn) return false;
  liveDevHand[drawn] += 1;
  liveHistory.push({ actor: 'You', color: CATAN_LOCAL_COLOR, message: 'bought a development card' });
  return true;
}

export function resetCatanWorkbenchCards(): void {
  for (const resource of RESOURCE_ORDER) {
    liveHand[resource] = 0;
    liveBank[resource] = WORKBENCH_BANK_START[resource];
  }
  for (const type of DEV_CARD_TYPES) liveDevHand[type] = 0;
  liveDevelopmentDeck = buildDevelopmentDeck(mulberry32(WORKBENCH_DEV_SEED));
  liveHistory.length = 0;
  setCatanTradeEditorOpen(false);
}
// Real events, appended after the seeded ones so the log reads as one timeline.
const liveHistory: CatanActionHistoryView[] = [];

// A roll's production: banked, then logged the way the seeded "received" entries read. The
// resource list is one icon per card, so three lumber shows three trees.
// One card, banked the moment it lands. Cards arrive one at a time on their own arcs, so the
// count has to tick up per arrival rather than jumping by the roll's total.
export function bankCatanResource(resource: Resource): void {
  liveHand[resource] += 1;
}

// Logged once the roll's last card is in, so the entry reports what actually arrived.
export function logCatanReceived(drawn: Resource[]): void {
  if (drawn.length) liveHistory.push({ actor: 'You', color: CATAN_LOCAL_COLOR, message: 'received', resources: drawn });
}

export function logCatanRoll(sum: number): void {
  liveHistory.push({ actor: 'You', color: CATAN_LOCAL_COLOR, message: `rolled a ${sum}` });
}

export function logCatanRobberMove(terrain: Terrain): void {
  liveHistory.push({ actor: 'You', color: CATAN_LOCAL_COLOR, message: `moved the robber to the ${terrain} tile` });
}

// What a flying card is drawn as: the same glyph and fill its hand card wears, so it reads as
// that card crossing the screen and lands on an exact color match.
export function catanResourceFace(resource: Resource): { emoji: string; fill: Rgb } {
  const look = RESOURCE_LOOK[resource];
  return { emoji: look.emoji, fill: look.fill };
}

// The seeded view with the live hand grafted on. The local seat's public card count has to be
// derived here too, or the players table would keep advertising the seeded number.
export function catanWorkbenchView(): CatanCardsView {
  const seeded = CATAN_CARD_WORKBENCH_VIEW;
  const held = RESOURCE_ORDER.reduce((sum, resource) => sum + liveHand[resource], 0);
  const dev = DEV_CARD_TYPES.reduce((sum, type) => sum + liveDevHand[type], 0);
  return {
    ...seeded,
    hand: { ...liveHand },
    devHand: { ...liveDevHand },
    bank: { ...liveBank },
    developmentDeck: liveDevelopmentDeck.length,
    // The workbench is the one view whose cards may be clicked; see adjustCatanWorkbenchHand.
    editable: true,
    localPlayer: { ...seeded.localPlayer, resourceCards: held, developmentCards: dev },
    history: [...seeded.history, ...liveHistory],
  };
}

// Uneven counts and mixed events exercise count corners, hidden-card summaries, resource icons,
// and chat folded into the same chronological action history. Enough entries to overflow the
// history viewport, so the scrollbar has something to show.
export const CATAN_CARD_WORKBENCH_VIEW: CatanCardsView = {
  localPlayer: { name: 'You', color: CATAN_LOCAL_COLOR, publicVp: 3, resourceCards: 0, developmentCards: 0, knights: 2, longestRoad: 5, active: true },
  // Replaced by the live hand in catanWorkbenchView(); the zeros are what a fresh board starts on.
  hand: { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 },
  // Replaced by the live dev hand in catanWorkbenchView(); a fresh board holds none.
  devHand: { knight: 0, victoryPoint: 0, roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 },
  bank: { ...WORKBENCH_BANK_START },
  developmentDeck: 25,
  opponents: [
    { name: 'claude-haiku-4.5', color: 'blue', publicVp: 2, resourceCards: 3, developmentCards: 0, knights: 1, longestRoad: 4 },
    // Holds Longest Road at 10 (two digits, keeping the row's widest case covered).
    { name: 'gpt-5-nano', color: 'orange', publicVp: 2, resourceCards: 2, developmentCards: 1, knights: 0, longestRoad: 10, hasLongestRoad: true },
    // Holds Largest Army at exactly the LARGEST_ARMY_MIN of 3.
    { name: 'gemini-3-flash', color: 'purple', publicVp: 4, resourceCards: 6, developmentCards: 2, knights: 3, longestRoad: 6, hasLargestArmy: true },
  ],
  history: [
    { actor: 'You', color: 'red', message: `placed a settlement ${SETTLEMENT_ICON}` },
    { actor: 'You', color: 'red', message: `placed a road ${ROAD_ICON}` },
    { actor: 'claude-haiku-4.5', color: 'blue', message: `placed a settlement ${SETTLEMENT_ICON}` },
    { actor: 'claude-haiku-4.5', color: 'blue', message: `placed a road ${ROAD_ICON}` },
    { actor: 'gpt-5-nano', color: 'orange', message: `placed a settlement ${SETTLEMENT_ICON}` },
    { actor: 'gpt-5-nano', color: 'orange', message: 'good luck all', chat: true },
    { actor: 'gemini-3-flash', color: 'purple', message: `placed a settlement ${SETTLEMENT_ICON}` },
    { actor: 'gemini-3-flash', color: 'purple', message: `placed a road ${ROAD_ICON}` },
    { actor: 'You', color: 'red', message: 'rolled a 9' },
    { actor: 'You', color: 'red', message: 'received', resources: ['grain', 'lumber'] },
    { actor: 'gemini-3-flash', color: 'purple', message: 'received', resources: ['ore'] },
    { actor: 'claude-haiku-4.5', color: 'blue', message: 'rolled a 4' },
    { actor: 'claude-haiku-4.5', color: 'blue', message: 'received', resources: ['brick', 'brick'] },
    { actor: 'claude-haiku-4.5', color: 'blue', message: `built a road ${ROAD_ICON}` },
    { actor: 'gpt-5-nano', color: 'orange', message: 'rolled a 7' },
    { actor: 'gpt-5-nano', color: 'orange', message: 'moved the robber to the ore hex' },
    { actor: 'gpt-5-nano', color: 'orange', message: 'stole a card from gemini-3-flash' },
    { actor: 'gemini-3-flash', color: 'purple', message: 'rude', chat: true },
    { actor: 'gemini-3-flash', color: 'purple', message: 'rolled an 11' },
    { actor: 'You', color: 'red', message: 'received', resources: ['wool'] },
    { actor: 'You', color: 'red', message: 'rolled a 6' },
    { actor: 'You', color: 'red', message: 'received', resources: ['brick', 'grain'] },
    { actor: 'You', color: 'red', message: 'bought a development card' },
    { actor: 'claude-haiku-4.5', color: 'blue', message: 'rolled an 8' },
    { actor: 'claude-haiku-4.5', color: 'blue', message: 'received', resources: ['lumber', 'wool', 'wool'] },
    { actor: 'claude-haiku-4.5', color: 'blue', message: 'anyone need sheep? I have plenty', chat: true },
    { actor: 'gpt-5-nano', color: 'orange', message: 'traded 2 wheat for 1 ore' },
    { actor: 'gpt-5-nano', color: 'orange', message: 'saving for a city', chat: true },
    { actor: 'gemini-3-flash', color: 'purple', message: 'rolled a 5' },
    { actor: 'gemini-3-flash', color: 'purple', message: 'received', resources: ['ore', 'ore'] },
    { actor: 'gemini-3-flash', color: 'purple', message: 'upgraded to a city' },
    { actor: 'You', color: 'red', message: 'rolled a 10' },
    { actor: 'You', color: 'red', message: `built a road ${ROAD_ICON}` },
    { actor: 'claude-haiku-4.5', color: 'blue', message: 'played a knight' },
    { actor: 'claude-haiku-4.5', color: 'blue', message: 'moved the robber to the wheat hex' },
    { actor: 'gpt-5-nano', color: 'orange', message: 'rolled a 3' },
    { actor: 'gpt-5-nano', color: 'orange', message: 'received', resources: ['brick'] },
    { actor: 'gemini-3-flash', color: 'purple', message: 'claimed the longest road' },
    { actor: 'gemini-3-flash', color: 'purple', message: 'anyone trading wheat?', chat: true },
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
    // No title: the cards are self-evident. Just the row of faces, a row of air above it, and
    // the panel's bottom pad.
    handHeight: HAND_PAD_T + (compact ? CARD_H_COMPACT : CARD_H) + HAND_PAD_B,
  };
}

// A deliberately flat rectangle like the reference cards: one uninterrupted color field, the
// glyph over its name, and a plain white count in the top-right. No frame. `dim` swaps in the
// spent-slot colors without touching the geometry, so an empty card holds its place in the row.
function card(look: ResourceLook, count: number, height = CARD_H, dim = false, selected = false): Node {
  const fill = dim ? EMPTY_FILL : look.fill;
  const ink = dim ? EMPTY_INK : look.ink;
  const countInk = dim ? EMPTY_INK : COUNT_INK;
  // Glyph and name read as one block, so center the pair rather than each row; the count keeps
  // the top-right corner and overlaps whatever blank space is left above.
  const glyphRow = Math.floor((height - 2) / 2);
  // A name whose length differs in parity from the card width has no exact center: the leftover
  // splits into a half cell per side. The layout's own centering rounds that half to the right,
  // which left `wood` — the one even-length name — visibly shoved toward the card's right edge.
  // Flooring the column instead biases the odd cell left, matching how the names read as a set.
  // Clamped to one so a name only a cell short of the card keeps a left margin rather than
  // sitting flush against the edge, which reads as a rendering fault.
  const spare = CARD_W - look.name.length;
  const nameLeft = spare <= 0 ? 0 : Math.max(1, Math.floor(spare / 2));
  return Box({ width: CARD_W, height, position: 'relative', background: fill }, [
    ...(selected
      ? [Box({ position: 'absolute', top: 0, left: 0, width: 1, height: 1 }, [Text({ text: '✓', style: { color: COUNT_INK, bold: true } })])]
      : []),
    Box({ position: 'absolute', top: 0, right: COUNT_RIGHT, width: 2, height: 1, justifyContent: 'center' }, [
      Text({ text: `${count}`, style: { color: countInk, bold: true } }),
    ]),
    Box({ position: 'absolute', top: glyphRow, left: EMOJI_LEFT, width: 2, height: 1 }, [
      Text({ text: look.emoji, style: { color: ink } }),
    ]),
    Box({ position: 'absolute', top: glyphRow + 1, left: nameLeft, width: look.name.length, height: 1 }, [
      Text({ text: look.name, style: { color: ink, bold: true } }),
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
  const body = truncate(`${entry.message}${resourceIcons ? ` ${resourceIcons}` : ''}`, HISTORY_ROW_W - stringWidth(entry.actor) - 1);
  return Box({ width: HISTORY_ROW_W, gap: 1, overflow: 'hidden' }, [
    Text({ text: entry.actor, style: { color: PLAYER_LOOK[entry.color], bold: true } }),
    Text({ text: body, style: { color: entry.chat ? RAIL_MUTED : RAIL_TEXT } }),
  ]);
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
// `flag` promotes a value out of the muted default when the game state says it matters: gold for
// the seat that HOLDS an award, red for a hand the robber would force a discard from. Both are
// decided by the rules engine (award holders, DISCARD_LIMIT), never by comparing numbers here —
// the highest army is not necessarily the holder, and the threshold is a rule, not a style.
const STAT_COLUMNS: { head: string; w: number; strong?: boolean; read: (p: CatanCardsPlayerView) => number; flag?: (p: CatanCardsPlayerView) => Rgb | null }[] = [
  { head: 'cards', w: 5, read: (p) => p.resourceCards, flag: (p) => (p.resourceCards > DISCARD_LIMIT ? AT_RISK : null) },
  { head: DEV_CARD_ICON, w: 3, read: (p) => p.developmentCards },
  { head: KNIGHT_ICON, w: 3, read: (p) => p.knights, flag: (p) => (p.hasLargestArmy ? AWARD : null) },
  { head: ROAD_ICON, w: 3, read: (p) => p.longestRoad, flag: (p) => (p.hasLongestRoad ? AWARD : null) },
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
    // vp is the score, so it keeps the reading white; the rest are supporting detail until a
    // flag promotes them.
    ...STAT_COLUMNS.map((c) => {
      const flag = c.flag?.(player) ?? null;
      return statCell(`${c.read(player)}`, c.w, flag ?? (c.strong ? RAIL_TEXT : RAIL_MUTED), flag !== null || c.strong);
    }),
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

// TEMPORARY (testing): left-click a hand card to add one of that resource, right-click to spend
// one, and the count floors at zero. Both write module state through the workbench setters rather
// than the `view` handed in, which is rebuilt every frame — mutating that would last exactly until
// the next repaint. Delete this and the wrappers in `handPanel` once a live CatanState feeds the
// HUD, since the rules engine is the only thing allowed to move cards then.
function adjustHand(resource: Resource, ev: PointerHit): boolean {
  if (ev.type !== 'down') return false;
  return adjustCatanWorkbenchHand(resource, ev.button === 2 ? -1 : 1);
}

// Same click contract as the resource hand: left draws one of that development card, right
// discards one.
function adjustDevHand(type: DevCardType, ev: PointerHit): boolean {
  if (ev.type !== 'down') return false;
  return adjustCatanWorkbenchDev(type, ev.button === 2 ? -1 : 1);
}

interface WorkbenchActionColors {
  background: Rgb;
  hover: Rgb;
  pressed: Rgb;
}

function workbenchActionButton(
  id: string,
  icon: string,
  label: string,
  enabled: boolean,
  onClick: () => void,
  colors: WorkbenchActionColors = {
    background: ACTION_BG,
    hover: ACTION_HOVER,
    pressed: [221, 241, 244],
  },
): Node {
  const ink: Rgb = enabled ? [242, 247, 249] : ACTION_DISABLED_INK;
  const content = (): Node[] => [
    Text({ text: icon, style: { color: ink, bold: true } }),
    Text({ text: label, style: { color: ink, bold: true } }),
  ];
  if (!enabled) {
    return Box({
      width: HAND_ACTION_W,
      height: CARD_H,
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: ACTION_DISABLED,
      color: ACTION_DISABLED_INK,
      hover: { background: [55, 60, 70], color: [142, 148, 161] },
    }, content());
  }
  const button = Button({
    id,
    label: '',
    onClick,
    style: {
      width: HAND_ACTION_W,
      height: CARD_H,
      padding: 0,
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: colors.background,
      color: [242, 247, 249],
      bold: true,
      hover: { background: colors.hover, color: [255, 255, 255] },
      focus: { background: colors.hover, color: [255, 255, 255] },
      pressed: { background: colors.pressed, color: [19, 48, 54] },
    },
  });
  button.children = content();
  return button;
}

function canBuyWorkbenchDev(view: CatanCardsView): boolean {
  return view.developmentDeck > 0 && RESOURCE_ORDER.every((resource) => view.hand[resource] >= COSTS.devCard[resourceIndex(resource)]);
}

function canOpenWorkbenchTrade(view: CatanCardsView): boolean {
  return RESOURCE_ORDER.some((resource) => view.hand[resource] > 0);
}

function tradeCardButton(resource: Resource, count: number, enabled: boolean, onPick: () => void): Node {
  const face = card(RESOURCE_LOOK[resource], count, CARD_H, !enabled);
  if (!enabled) return face;
  const hit = Box({ width: CARD_W, height: CARD_H }, [face]);
  hit.onMouse = (ev): boolean => {
    if (ev.type !== 'down' || ev.button === 2) return false;
    onPick();
    return true;
  };
  return hit;
}

function tradeSourceRow(
  available: Record<Resource, number>,
  staged: Record<Resource, number>,
  onPick: (resource: Resource) => void,
): Node {
  return Box({ width: TRADE_ROW_W, gap: 1 }, RESOURCE_ORDER.map((resource) => {
    const remaining = available[resource] - staged[resource];
    return tradeCardButton(resource, remaining, remaining > 0, () => onPick(resource));
  }));
}

function tradeStagedRow(staged: Record<Resource, number>, onRemove: (resource: Resource) => void): Node {
  return Box({ width: TRADE_ROW_W, gap: 1 }, RESOURCE_ORDER.map((resource) => {
    const count = staged[resource];
    if (count === 0) return Box({ width: CARD_W, height: CARD_H, background: TRADE_SLOT_BG });
    return tradeCardButton(resource, count, true, () => onRemove(resource));
  }));
}

function tradeRailButton(id: string, label: string, enabled: boolean, onClick: () => void): Node {
  if (!enabled) {
    return Box({ width: ACTION_W, height: 6, alignItems: 'center', justifyContent: 'center', background: ACTION_DISABLED }, [
      Text({ text: label, style: { color: ACTION_DISABLED_INK, bold: true } }),
    ]);
  }
  return Button({
    id,
    label,
    onClick,
    style: {
      width: ACTION_W,
      height: 6,
      alignItems: 'center',
      justifyContent: 'center',
      background: TRADE_ACCENT,
      color: [13, 36, 41],
      bold: true,
      hover: { background: [102, 194, 201], color: [8, 27, 31] },
      focus: { background: [102, 194, 201], color: [8, 27, 31] },
      pressed: { background: [221, 241, 244], color: [19, 48, 54] },
    },
  });
}

function tradeEditor(view: CatanCardsView, onChange: () => void): Node {
  const valid = stagedBankTrade() !== null;
  const adjust = (side: 'give' | 'receive', resource: Resource, delta: number): void => {
    if (adjustCatanWorkbenchTradeStaging(side, resource, delta)) onChange();
  };
  const confirm = (): void => {
    if (performStagedCatanWorkbenchBankTrade()) onChange();
  };
  const close = (): void => {
    setCatanTradeEditorOpen(false);
    onChange();
  };
  return Box({
    position: 'absolute',
    left: HAND_PANEL_LEFT,
    bottom: 1,
    width: TRADE_PANEL_W,
    gap: 1,
  }, [
    Box({ width: TRADE_TABLE_W, flexDirection: 'column', gap: 1, padding: [1, 2], background: TRADE_BG }, [
      Text({ text: 'bank', style: { color: RAIL_TEXT, bold: true } }),
      tradeSourceRow(view.bank, workbenchTradeGet, (resource) => adjust('receive', resource, 1)),
      Text({ text: 'bank sends  ↓', style: { color: RAIL_MUTED, bold: true } }),
      tradeStagedRow(workbenchTradeGet, (resource) => adjust('receive', resource, -1)),
      tradeStagedRow(workbenchTradeGive, (resource) => adjust('give', resource, -1)),
      Text({ text: 'your hand   ↑ you send', style: { color: RAIL_MUTED, bold: true } }),
      tradeSourceRow(view.hand, workbenchTradeGive, (resource) => adjust('give', resource, 1)),
    ]),
    Box({ width: ACTION_W, flexDirection: 'column', gap: 1, padding: [1, 0], background: TRADE_BG }, [
      Text({ text: 'trade', style: { color: RAIL_TEXT, bold: true } }),
      tradeRailButton('catan-trade-confirm', 'bank trade', valid, confirm),
      Box({ width: ACTION_W, height: 6, alignItems: 'center', justifyContent: 'center', background: ACTION_DISABLED }, [
        Text({ text: 'player soon', style: { color: ACTION_DISABLED_INK, bold: true } }),
      ]),
      Button({
        id: 'catan-trade-close',
        label: 'x close',
        onClick: close,
        style: {
          width: ACTION_W,
          height: 4,
          alignItems: 'center',
          justifyContent: 'center',
          background: ACTION_BG,
          color: RAIL_TEXT,
          bold: true,
          hover: { background: ACTION_HOVER, color: [255, 255, 255] },
        },
      }),
    ]),
  ]);
}

// Bottom-left corner only: the panel hugs its cards instead of spanning the window, so the board
// stays visible across the rest of the bottom row.
// The resource hand and the development hand are two groups of the same card, split by a seam:
// resources are spendable, dev cards are played. Only dev cards actually held are drawn, so the
// panel grows and shrinks with the hand instead of showing five mostly-empty purple slots.
function handPanel(view: CatanCardsView, layout: CatanCardsLayout, avail: number, onChange: () => void): Node {
  const height = layout.compact ? CARD_H_COMPACT : CARD_H;
  const visibleDevTypes = view.editable
    ? DEV_CARD_TYPES
    : DEV_CARD_TYPES.filter((type) => view.devHand[type] > 0);
  const visibleDevWidth = devHandWidth(visibleDevTypes.length);
  const showActions = view.editable === true && avail >= RESOURCE_HAND_W + HAND_ACTION_GAP + ACTIONS_W;
  const showDev = visibleDevTypes.length > 0
    && avail >= RESOURCE_HAND_W + visibleDevWidth + (showActions ? HAND_ACTION_GAP + ACTIONS_W : 0);
  // A card is wrapped in its own click target only on an editable (workbench) view. In the game
  // the wrapper is skipped entirely, so the hit-test finds nothing interactive over the hand and
  // a click falls through to the board exactly as it did before the cards existed.
  const clickable = (face: Node, onMouse: (ev: PointerHit) => boolean): Node => {
    if (!view.editable) return face;
    // The wrapper carries the handler so `card` stays presentational. The hit-test takes the
    // innermost INTERACTIVE node and the face has none, so it never competes; `Box` has no
    // handler slot, hence attaching it to the node.
    const hit = Box({ width: CARD_W, height }, [face]);
    hit.onMouse = onMouse;
    return hit;
  };
  const devCards = !showDev
    ? []
    : visibleDevTypes.map((type) => Tooltip({
        id: `catan-dev-${type}`,
        content: [
          { text: DEV_CARD_HELP[type].title, bold: true },
          DEV_CARD_HELP[type].effect,
        ],
        maxWidth: 46,
      }, clickable(
        card(DEV_HAND_LOOK[type], view.devHand[type], height, view.devHand[type] === 0),
        (ev) => adjustDevHand(type, ev),
      )));
  const cards = RESOURCE_ORDER.map((resource) =>
    clickable(card(RESOURCE_LOOK[resource], view.hand[resource], height, view.hand[resource] === 0), (ev) => adjustHand(resource, ev)),
  );
  const actions = !showActions
    ? []
    : [
        Tooltip({
          id: 'catan-trade',
          content: [
            { text: 'Trade', bold: true },
            'Exchange resources with the bank. Player trades are coming later.',
          ],
          maxWidth: 34,
        }, workbenchActionButton(
          'catan-trade-open',
          `${RESOURCE_LOOK.lumber.emoji}⇄${RESOURCE_LOOK.wool.emoji}`,
          'trade',
          canOpenWorkbenchTrade(view),
          () => {
            setCatanTradeEditorOpen(!workbenchTradeOpen);
            onChange();
          },
        )),
        Tooltip({
          id: 'catan-buy-dev',
          content: [
            { text: 'Buy development card', bold: true },
            'Costs 🐑 🌾 🪨. Draws from the remaining deck.',
          ],
          maxWidth: 36,
        }, workbenchActionButton('catan-buy-dev', DEV_CARD_ICON, 'buy dev', canBuyWorkbenchDev(view), () => {
          if (buyCatanWorkbenchDevCard()) onChange();
        }, {
          background: DEV_LOOK.fill,
          hover: CATAN_CARD.devActionHover,
          pressed: CATAN_CARD.devActionPressed,
        })),
      ];
  const tray = Box({ height: layout.handHeight, gap: HAND_SPLIT_GAP, padding: [HAND_PAD_T, HAND_PAD_X, HAND_PAD_B, HAND_PAD_X], background: uiChromeBg(0.9) }, [
    Box({ gap: 1 }, cards),
    ...(devCards.length === 0 ? [] : [Box({ gap: 1 }, devCards)]),
  ]);
  return Box({ position: 'absolute', left: HAND_PANEL_LEFT, bottom: 1, height: layout.handHeight, gap: HAND_ACTION_GAP }, [
    tray,
    ...(actions.length === 0 ? [] : [Box({ height: layout.handHeight, gap: ACTION_BUTTON_GAP, alignItems: 'center' }, actions)]),
  ]);
}

// Where a card flying in from its tile is headed: centred on its resource's column, on the card
// face's own first row. The chip is clipped against exactly this row, so it crosses the panel's
// top padding in full view and vanishes where the colour starts — the cut lands on the card's
// edge rather than on the dark strip above it. Arriving and being banked are the same instant.
//
// Derived from the same constants handPanel lays out with, because a laid out node's position
// cannot be read back from outside the paint. Keep the two in step: this is the panel's own
// geometry (bottom-left anchor, one column of padding, cards a column apart) restated, and the
// dev half never matters here since only resources are ever thrown.
export function catanHandLandingCell(region: LayoutBox, resource: Resource): { col: number; row: number } {
  const layout = catanCardsLayout(region);
  const panelTop = region.h - 1 - layout.handHeight;
  const left = HAND_PANEL_LEFT + HAND_PAD_X + RESOURCE_ORDER.indexOf(resource) * (CARD_W + 1);
  return { col: left + Math.floor(CARD_W / 2), row: panelTop + HAND_PAD_T };
}

export function buildCatanCardsOverlay(region: LayoutBox, onCloseSidebar: () => void, view: CatanCardsView = catanWorkbenchView(), onWorkbenchChange: () => void = () => {}): Node {
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
    // The hand shares the bottom row with the board, and the rail eats into it. Hand it the
    // width actually left over so it can drop its optional half instead of sliding under the rail.
    ...(view.editable && workbenchTradeOpen
      ? [tradeEditor(view, onWorkbenchChange)]
      : [handPanel(view, layout, region.w - (showSidebar ? RAIL_W : 0) - 2, onWorkbenchChange)]),
  ]);
}
