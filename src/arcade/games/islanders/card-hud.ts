// The Islanders card-UI workbench. It accepts a viewer-safe snapshot and renders the local hand plus
// a toggleable sidebar holding the game log, the public bank supply, and player summaries.
// The seeded snapshot lets the "Board + cards" test mode evolve before a live IslandersState is
// attached; gameplay wiring should later replace only the data source, not the card or rail layout.

import {
  Box,
  Button,
  ScrollBox,
  Sidebar,
  SIDEBAR_HEADER_H,
  SIDEBAR_PAD_L,
  SIDEBAR_PAD_R,
  SIDEBAR_PAD_V,
  Slot,
  Table,
  TableCell,
  TableHeader,
  TableRow,
  Text,
  Tooltip,
  wrapText,
  type ColumnDef,
  type LayoutBox,
  type Node,
  type PointerHit,
  type Row,
  type Screen,
} from '../../../tui/index.ts';
import { stringWidth } from '../../../engine/index.ts';
import { ARCADE_CHROME_TEXT, RAIL_MUTED_FG, RAIL_TEXT_FG, uiChromeBg } from '../../theme.ts';
import { COSTS, DEV_CARD_TYPES, type DevCardType, DISCARD_LIMIT, type Resource, resourceIndex } from '../../../rules/islanders/types.ts';
import {
  ISLANDERS_CARD,
  type IslandersCardLook as ResourceLook,
  type IslandersRgb as Rgb,
  DEV_CARD_ICON,
  DEV_HAND_LOOK,
  DEV_LOOK,
  KNIGHT_ICON,
  PLAYER_LOOK,
  RESOURCE_LOOK,
  RESOURCE_ORDER,
  ROAD_ICON,
} from './palette.ts';
import type { IslandersActionHistoryView, IslandersCardsPlayerView, IslandersCardsView } from './card-types.ts';
import {
  adjustIslandersWorkbenchDiscard,
  adjustIslandersWorkbenchHand,
  adjustIslandersWorkbenchTradeStaging,
  beginIslandersWorkbenchDiscard,
  beginIslandersWorkbenchDevelopmentPlay,
  beginIslandersWorkbenchDevPurchase,
  beginStagedIslandersWorkbenchBankTrade,
  beginStagedIslandersWorkbenchPortTrade,
  buyIslandersWorkbenchDevCard,
  canSubmitIslandersWorkbenchDiscard,
  cancelIslandersWorkbenchPlayerTrade,
  islandersTradeEditorOpen,
  islandersWorkbenchDiscardOpen,
  islandersWorkbenchDiscardRequired,
  chooseIslandersWorkbenchDevelopmentResource,
  islandersWorkbenchPlayerTradeOffers,
  islandersWorkbenchView,
  completeIslandersWorkbenchPlayerTrade,
  createIslandersWorkbenchPlayerTrade,
  departIslandersWorkbenchBankResource,
  departIslandersWorkbenchHandResource,
  departIslandersWorkbenchDevCard,
  landIslandersWorkbenchBankResource,
  landIslandersWorkbenchDevCard,
  logIslandersWorkbenchDevPurchase,
  logIslandersWorkbenchDiscard,
  logIslandersWorkbenchMaritimeTrade,
  performStagedIslandersWorkbenchBankTrade,
  performStagedIslandersWorkbenchPortTrade,
  reserveIslandersWorkbenchDiscard,
  setIslandersTradeEditorOpen,
  stagedIslandersBankTrade,
  stagedIslandersPortTrade,
  stagedIslandersPlayerTradeValid,
  submitIslandersWorkbenchDiscard,
  workbenchDiscardSelection,
  workbenchTradeGet,
  workbenchTradeGive,
  type IslandersPlayerTradeOffer,
} from './card-workbench.ts';

export type { IslandersActionHistoryView, IslandersCardsPlayerView, IslandersCardsView } from './card-types.ts';
export {
  adjustIslandersWorkbenchDiscard,
  adjustIslandersWorkbenchDev,
  adjustIslandersWorkbenchHand,
  adjustIslandersWorkbenchTradeStaging,
  bankIslandersResource,
  beginIslandersWorkbenchDiscard,
  beginIslandersWorkbenchDevelopmentPlay,
  beginIslandersWorkbenchDevPurchase,
  beginStagedIslandersWorkbenchBankTrade,
  beginStagedIslandersWorkbenchPortTrade,
  buyIslandersWorkbenchDevCard,
  canSubmitIslandersWorkbenchDiscard,
  cancelIslandersWorkbenchPlayerTrade,
  ISLANDERS_CARD_WORKBENCH_VIEW,
  ISLANDERS_LOCAL_COLOR,
  islandersResourceFace,
  islandersTradeEditorOpen,
  islandersWorkbenchDiscardOpen,
  islandersWorkbenchDiscardRequired,
  islandersWorkbenchDevelopmentPlay,
  islandersWorkbenchPlayerTradeOffers,
  islandersWorkbenchView,
  completeIslandersWorkbenchPlayerTrade,
  completeIslandersWorkbenchDevelopmentStep,
  createIslandersWorkbenchPlayerTrade,
  departIslandersWorkbenchBankResource,
  departIslandersWorkbenchHandResource,
  departIslandersWorkbenchDevCard,
  landIslandersWorkbenchBankResource,
  landIslandersWorkbenchDevCard,
  logIslandersReceived,
  logIslandersRobberMove,
  logIslandersRoll,
  logIslandersWorkbenchDevPurchase,
  logIslandersWorkbenchDiscard,
  logIslandersWorkbenchMaritimeTrade,
  performIslandersWorkbenchBankTrade,
  performIslandersWorkbenchPortTrade,
  performStagedIslandersWorkbenchBankTrade,
  performStagedIslandersWorkbenchPortTrade,
  chooseIslandersWorkbenchDevelopmentResource,
  finishIslandersWorkbenchDevelopmentPlay,
  resetIslandersWorkbenchCards,
  reserveIslandersWorkbenchDiscard,
  resolveIslandersWorkbenchPlayerTradeOffer,
  setIslandersTradeEditorOpen,
  setIslandersWorkbenchTradeSelection,
  submitIslandersWorkbenchDiscard,
} from './card-workbench.ts';

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
const COUNT_INK = ISLANDERS_CARD.countInk;
// A resource you hold none of keeps its card, so the row never reflows as a hand empties and
// refills. The fill drops to a lift off the panel background and the name and count go muted:
// present, plainly spent. The emoji cannot follow — terminals paint it in its own colors and
// ignore the foreground we set — so a zero card keeps a full-color glyph over the gray.
const EMPTY_FILL = ISLANDERS_CARD.emptyFill;
const EMPTY_INK: Rgb = RAIL_MUTED_FG;
// Gold marks a held award; red marks a hand the robber would force a discard from.
const AWARD = ISLANDERS_CARD.award;
const AT_RISK = ISLANDERS_CARD.atRisk;

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
// These are intentionally independent. The action pair needs its own seam, and the whole pair
// needs more air from the taller hand tray so their different silhouettes feel deliberate.
const HAND_ACTION_GAP = 2;
const ACTION_BUTTON_GAP = 2;
// trade, buy dev, and the turn card (roll / end) sit in one row by the hand.
const ACTIONS_W = HAND_ACTION_W * 3 + ACTION_BUTTON_GAP * 2;
const ACTION_BG = ISLANDERS_CARD.actionBg;
const ACTION_HOVER = ISLANDERS_CARD.actionHover;
const ACTION_DISABLED = ISLANDERS_CARD.actionDisabled;
const ACTION_DISABLED_INK = ISLANDERS_CARD.actionDisabledInk;
const TURN_ACTION_COLORS = {
  background: ISLANDERS_CARD.turnActionBg,
  hover: ISLANDERS_CARD.turnActionHover,
  pressed: ISLANDERS_CARD.turnActionPressed,
};

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

// The expanded editor replaces the compact hand in-place. Its four rows are the bank, requested
// cards, offered cards, and the player's hand. The action rail uses the same row height and gap so
// every button lines up with one card row.
const TRADE_ROW_W = RESOURCE_ORDER.length * CARD_W + (RESOURCE_ORDER.length - 1);
const TRADE_TABLE_W = TRADE_ROW_W + 4;
const TRADE_PANEL_W = TRADE_TABLE_W + HAND_ACTION_GAP + HAND_ACTION_W;
const TRADE_ROW_GAP = 1;
const TRADE_PANEL_PAD_V = 1;
const TRADE_PANEL_H = CARD_H * 4 + TRADE_ROW_GAP * 3 + TRADE_PANEL_PAD_V * 2;
const DISCARD_PANEL_H = CARD_H * 2 + TRADE_ROW_GAP + TRADE_PANEL_PAD_V * 2;
const TRADE_BG = ISLANDERS_CARD.tradeBg;
const TRADE_SLOT_BG = ISLANDERS_CARD.tradeSlotBg;
// Player offers use compact exchange tokens rather than the full hand-card silhouette. Their
// width stays intrinsic: the two exchange rows establish the panel width, while the lower row
// also reserves exactly enough room for the response controls.
const PLAYER_TRADE_IDENTITY_W = 4;
const PLAYER_TRADE_TOKEN_GAP = 2;
const PLAYER_TRADE_H = 5;
const PLAYER_TRADE_ROW_H = 2;
// A one-row control avoids the unavoidable half-row vertical bias of a glyph inside a two-row
// button. Three columns leave a true center cell and still read as a compact square-like action.
const PLAYER_TRADE_DECISION_W = 3;
const PLAYER_TRADE_DECISION_H = 1;

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
// The panel background runs flush to the terminal edge (SIDEBAR_PAD_R is 0, so no translucent strip
// shows the scene through it); the body carries its own right inset so text is not jammed against
// that edge. Width is set by the one bank row plus all three insets.
const BODY_PAD_R = 2;
export const ISLANDERS_RAIL_W = BANK_CARDS * CARD_W + (BANK_CARDS - 1) + SIDEBAR_PAD_L + SIDEBAR_PAD_R + BODY_PAD_R;
const RAIL_W = ISLANDERS_RAIL_W;
// The panel's full content width. The history ScrollBox spans all of it so its scrollbar lands on
// the panel's last column — flush, the way the chess chat's does. Everything else is inset from
// that edge by BODY_PAD_R so text is not jammed against it.
const CONTENT_W = RAIL_W - SIDEBAR_PAD_L - SIDEBAR_PAD_R;
const RAIL_INNER = CONTENT_W - BODY_PAD_R;
// The width a full-row control in the sidebar body spans (the chat composer): the same margin
// on the right as the panel's left inset.
export const ISLANDERS_RAIL_INNER_W = RAIL_INNER;
// Rows stop two columns short of the ScrollBox: one for the bar, one blank beside it, so text can
// never sit flush against the bar. Mirrors the chat's SCROLLBAR_W + RIGHT_GAP reservation.
const HISTORY_ROW_W = CONTENT_W - 2;
// The log takes every row the fixed sections leave, so the bank and the players table sit at
// the panel's bottom whatever the seat count, and an empty log at game start is just room the
// entries grow into. Below this many rows the other sections start giving ground.
const HISTORY_MIN_H = 4;

// The bank and the players table are the rail's reason to exist, so the rail never hides for
// lack of height. As rows run out the sections give ground in order: the log shrinks to its
// minimum, the players table drops the air between its rows, the bank folds from a row of cards
// to one line of counts, and last the log gives up its remaining rows for a one-line hint.
export interface IslandersRailPlan {
  // Rows of the log block (viewport plus composer); 0 means the hint stands in for it.
  logH: number;
  compactBank: boolean;
  playerRowGap: 0 | 1;
  // Offset from the rail's top row to the first row of the bank (cards or line).
  bankTop: number;
}

// The chat composer rides inside the log block, so the block's minimum grows with it:
// `composerRows` is the Input's current height (0 with no human seated), which the HUD build reads
// off the node and the flight geometry is handed by its caller, so both see the same rail.
// Every row of the rail that is not the log block: the panel's insets and header, the bank
// (label + cards, or one line), the players table, and the gap under each body child but the last.
function railFixedH(playerCount: number, compactBank: boolean, playerRowGap: 0 | 1): number {
  const bank = compactBank ? 1 : 1 /* label */ + 1 /* gap */ + CARD_H;
  const players = 1 /* header */ + playerCount + playerCount * playerRowGap;
  const gaps = 2; // under the log block and under the bank
  return SIDEBAR_PAD_V * 2 + SIDEBAR_HEADER_H + bank + gaps + players;
}

export function islandersRailPlan(region: LayoutBox, playerCount: number, composerRows: number): IslandersRailPlan {
  const composer = composerRows ? composerRows + 1 : 0;
  const logMin = HISTORY_MIN_H + composer;
  const tiers: [boolean, 0 | 1][] = [[false, 1], [false, 0], [true, 0]];
  for (const [compactBank, playerRowGap] of tiers) {
    const spare = region.h - railFixedH(playerCount, compactBank, playerRowGap);
    if (spare >= logMin) return { logH: spare, compactBank, playerRowGap, bankTop: railBankTop(spare, compactBank) };
  }
  // Even the tightest layout leaves the log short: keep whatever rows remain (at least one line
  // beside the composer), or swap in the hint when not even that fits.
  const spare = region.h - railFixedH(playerCount, true, 0);
  const logH = spare >= 1 + composer ? spare : 0;
  return { logH, compactBank: true, playerRowGap: 0, bankTop: railBankTop(Math.max(logH, 1), true) };
}

function railBankTop(logH: number, compactBank: boolean): number {
  return SIDEBAR_PAD_V + SIDEBAR_HEADER_H + logH + 1 /* gap */ + (compactBank ? 0 : 1 /* label */ + 1 /* gap */);
}

// Player colors are font colors here, never fills — a seat's color reads as its name's ink the
// way a model's creator tint does in the chess chat, which is what these become once models sit
// at the table.
export { PLAYER_LOOK } from './palette.ts';

// Only what an opponent can legitimately see and act on: hand size, unplayed dev cards, knights
// already played, and how long their road actually runs. `longestRoad` is a run length, not a
// count of placed segments — the two differ and it is the run that decides the card.
// ── Sidebar visibility ──────────────────────────────────────────────────────────────────────
// Module state, like the tile panel's robber flag: the HUD is rebuilt every frame from these.
// Starts collapsed to its reopen pill, the way the poker chat rail does.
let sidebarOpen = false;
export function islandersSidebarOpen(): boolean {
  return sidebarOpen;
}
// Whether the rail is actually on screen: open AND the terminal is big enough to draw it. The
// renderer insets the 3D viewport by ISLANDERS_RAIL_W, so it has to ask this rather than the raw flag
// — asking the flag reserves a 51-column strip that nothing paints on a small terminal.
export function islandersRailVisible(cols: number, rows: number): boolean {
  return sidebarOpen && islandersCardsLayout({ x: 0, y: 0, w: cols, h: rows }).showPublicRail;
}
export function toggleIslandersSidebar(): void {
  sidebarOpen = !sidebarOpen;
}

// Exported so callers (and tests) can reach the rows the way the chess HUD exposes its move
// history — the rail's Slot renders it through the component registry, not the node tree.
// The height here is a placeholder: every build resizes the viewport to its share of the
// terminal, which is only knowable once the region is in hand.
const islandersHistoryScroll = new ScrollBox({ id: 'islanders-history', width: CONTENT_W, height: HISTORY_MIN_H, rows: [] });

export function mountIslandersCardsHud(ui: Screen): void {
  ui.mount(islandersHistoryScroll);
}

export interface IslandersCardsLayout {
  compact: boolean;
  showPublicRail: boolean;
  railWidth: number;
  handHeight: number;
}

// Pure size policy — the sidebar toggle is applied at build time, so this stays a function of the
// region alone.
export function islandersCardsLayout(region: LayoutBox): IslandersCardsLayout {
  const compact = region.w < 96 || region.h < 34;
  return {
    compact,
    // Width alone decides: the rail is 51 columns and the board needs the rest. Height only
    // changes how the rail lays itself out (see islandersRailPlan).
    showPublicRail: region.w >= 112,
    railWidth: RAIL_W,
    // No title: the cards are self-evident. Just the row of faces, a row of air above it, and
    // the panel's bottom pad.
    handHeight: HAND_PAD_T + (compact ? CARD_H_COMPACT : CARD_H) + HAND_PAD_B,
  };
}

// A deliberately flat rectangle like the reference cards: one uninterrupted color field, the
// glyph over its name, and a plain white count in the top-right. No frame. `dim` swaps in the
// spent-slot colors without touching the geometry, so an empty card holds its place in the row.
// `hoverable` hands the fill to the wrapper `clickable` builds around the face, so the whole
// card can lighten under the pointer (a hover style only paints on the hovered node, and the
// tooltip trigger is that wrapper). The face's text then sits on the wrapper's fill.
function card(look: ResourceLook, count: number | null, height = CARD_H, dim = false, selected = false, hoverable = false): Node {
  const fill = hoverable ? 'transparent' : dim ? EMPTY_FILL : look.fill;
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
    ...(count === null
      ? []
      : [Box({ position: 'absolute', top: 0, right: COUNT_RIGHT, width: 2, height: 1, justifyContent: 'center' }, [
          Text({ text: `${count}`, style: { color: countInk, bold: true } }),
        ])]),
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
export function islandersHistoryRows(entry: IslandersActionHistoryView): Node[] {
  const grouped = RESOURCE_ORDER.flatMap((resource) => {
    const explicit = entry.resourceCounts?.[resource] ?? 0;
    const repeated = (entry.resources ?? []).filter((candidate) => candidate === resource).length;
    const count = explicit || repeated;
    return count > 0 ? [`${RESOURCE_LOOK[resource].emoji} x${count}`] : [];
  }).join('  ');
  const body = `${entry.message}${grouped ? `  ${grouped}` : ''}`;
  const actorWidth = stringWidth(entry.actor);
  const lines = wrapText(body, Math.max(1, HISTORY_ROW_W - 2), {
    first: Math.max(1, HISTORY_ROW_W - actorWidth - 1),
  });
  const color = entry.chat ? RAIL_MUTED : RAIL_TEXT;
  return [
    Box({ width: HISTORY_ROW_W, gap: 1, overflow: 'hidden' }, [
      Text({ text: entry.actor, style: { color: PLAYER_LOOK[entry.color], bold: true } }),
      Text({ text: lines[0] ?? '', style: { color } }),
    ]),
    ...lines.slice(1).map((line) => Text({
      text: `  ${line}`,
      style: { width: HISTORY_ROW_W, color },
    })),
  ];
}

function bankRow(view: IslandersCardsView): Node {
  return Box({ gap: 1 }, [
    ...RESOURCE_ORDER.map((resource) => card(RESOURCE_LOOK[resource], view.bank[resource])),
    card(DEV_LOOK, view.developmentDeck),
  ]);
}

// The bank folded to one line when the terminal is short: the section label, then each pile as
// its glyph and count. Every pile occupies BANK_LINE_PILE_W cells so the flight geometry can find
// a pile by index the same way it finds a card.
const BANK_LINE_LABEL = 'bank';
const BANK_LINE_PILE_W = 7;
function bankLine(view: IslandersCardsView): Node {
  const piles = [
    ...RESOURCE_ORDER.map((resource) => ({ look: RESOURCE_LOOK[resource], count: view.bank[resource] })),
    { look: DEV_LOOK, count: view.developmentDeck },
  ];
  return Box({ gap: 0 }, [
    sectionTitle(BANK_LINE_LABEL),
    ...piles.map(({ look, count }) => Box({ width: BANK_LINE_PILE_W, justifyContent: 'end' }, [
      Text({ text: `${look.emoji} ` }),
      Text({ text: `${count}`, style: { color: RAIL_TEXT, bold: true } }),
    ])),
  ]);
}

// ── Players table ───────────────────────────────────────────────────────────────────────────
// Model slugs are long enough (claude-haiku-4.5 is 16 cells) that a per-row "2 vp  cards: 3" label
// run no longer fits beside them. The labels move to a header instead and the stats become
// right-aligned columns, which keeps one line per seat, fits the full name, and lets the numbers
// be compared down a column.
// Each column is only as wide as its own header or widest value, so the name column keeps
// everything left over — a uniform width clipped the longest slug by a single cell.
// The score rides on the name (`name · 6`, or `name · 6 (7)` when hidden victory-point cards the
// viewer may know about raise the real total) rather than in a column: a seat's true score is
// private information, so the two numbers can't line up as one comparable column anyway. The
// supporting counts run from `cards` on the left.
const STAT_GAP = 1;
// `flag` promotes a value out of the muted default when the game state says it matters: gold for
// the seat that HOLDS an award, red for a hand the robber would force a discard from. Both are
// decided by the rules engine (award holders, DISCARD_LIMIT), never by comparing numbers here —
// the highest army is not necessarily the holder, and the threshold is a rule, not a style.
// `col` is the geometry the Table resolves; the name column is the flexible one, so adding or
// widening a stat no longer means recomputing the name's width by hand.
interface StatColumn {
  head: string;
  col: ColumnDef;
  read: (p: IslandersCardsPlayerView) => number;
  flag?: (p: IslandersCardsPlayerView) => Rgb | null;
}
const STAT_COLUMNS: StatColumn[] = [
  { head: 'cards', col: { width: 5, align: 'end' }, read: (p) => p.resourceCards, flag: (p) => (p.resourceCards > DISCARD_LIMIT ? AT_RISK : null) },
  { head: DEV_CARD_ICON, col: { width: 3, align: 'end' }, read: (p) => p.developmentCards },
  { head: KNIGHT_ICON, col: { width: 3, align: 'end' }, read: (p) => p.knights, flag: (p) => (p.hasLargestArmy ? AWARD : null) },
  { head: ROAD_ICON, col: { width: 3, align: 'end' }, read: (p) => p.longestRoad, flag: (p) => (p.hasLongestRoad ? AWARD : null) },
];
// The name column takes whatever the stats leave, down to a floor that keeps a seat
// identifiable rather than letting it collapse to nothing on a narrow terminal.
const PLAYER_COLUMNS: ColumnDef[] = [{ flex: 1, min: 8 }, ...STAT_COLUMNS.map((c) => c.col)];

// The section label doubles as the table's corner cell, so "players" heads the name column the
// way each icon heads its own — one header row instead of a title stacked on top of one.
function playersHeader(): Node {
  return TableHeader([
    TableCell(sectionTitle('players')),
    ...STAT_COLUMNS.map((c) => TableCell(c.head, { style: { color: RAIL_MUTED } })),
  ]);
}

// `name · 6`, with the real total in parentheses when it differs from the public one.
function playerScore(player: IslandersCardsPlayerView): string {
  const hidden = player.actualVp !== undefined && player.actualVp !== player.publicVp ? ` (${player.actualVp})` : '';
  return `${player.publicVp}${hidden}`;
}

function playerRow(player: IslandersCardsPlayerView): Node {
  const seat = PLAYER_LOOK[player.color];
  const name = Box({ gap: 0, overflow: 'hidden' }, [
    Text({ text: `${player.active ? '▸ ' : '  '}${player.name}`, style: { color: seat, bold: true, textOverflow: 'ellipsis' } }),
    Text({ text: ' · ', style: { color: RAIL_MUTED } }),
    Text({ text: playerScore(player), style: { color: RAIL_TEXT, bold: true } }),
  ]);
  return TableRow({}, [
    TableCell(name),
    // Supporting detail stays muted until a flag promotes it.
    ...STAT_COLUMNS.map((c) => {
      const flag = c.flag?.(player) ?? null;
      return TableCell(`${c.read(player)}`, {
        style: { color: flag ?? RAIL_MUTED, bold: flag !== null },
      });
    }),
  ]);
}

function playersTable(players: IslandersCardsPlayerView[], rowGap: 0 | 1): Node {
  return Table({ columns: PLAYER_COLUMNS, width: RAIL_INNER, gap: STAT_GAP, rowGap }, [
    playersHeader(),
    ...players.map(playerRow),
  ]);
}

// POV changes only choose which private hand is projected into `localPlayer`. They must not
// reorder the public player list: both the top-left legend and this sidebar stay in seat order.
export function islandersSidebarPlayers(view: IslandersCardsView): IslandersCardsPlayerView[] {
  return [...view.opponents, view.localPlayer].sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0));
}

// One continuous dark panel owning the full right strip — the same width the scene viewport is
// inset by, so the rail sits beside the board rather than over it. Its ✕ collapses it back to the
// reopen pill, mirroring the poker chat rail.
// The panel is titled for what sits directly under its header, the log; the bank and the players
// table follow as labelled sections, so no row is spent on a second title.
export const ISLANDERS_RAIL_TITLE = 'game log';
const LOG_HINT = 'taller terminal shows the log';

function sidebar(view: IslandersCardsView, onClose: () => void, plan: IslandersRailPlan, logComposer?: Node): Node {
  const players = islandersSidebarPlayers(view);
  // Only the ScrollBox reaches the panel edge; the rest is inset so it clears the scrollbar column.
  const inset = (child: Node): Node => Box({ width: { pct: 100 }, padding: [0, BODY_PAD_R, 0, 0] }, [child]);
  const composerH = typeof logComposer?.style.height === 'number' ? logComposer.style.height : 0;
  const logViewportH = Math.max(1, plan.logH - composerH - (logComposer ? 1 : 0));
  islandersHistoryScroll.setHeight(logViewportH);
  const log = plan.logH === 0
    ? inset(Text({ text: LOG_HINT, style: { color: RAIL_MUTED } }))
    : Box({
        flexDirection: 'column',
        gap: logComposer ? 1 : 0,
        height: plan.logH,
        overflow: 'visible',
      }, [
        Slot('islanders-history'),
        ...(logComposer ? [inset(logComposer)] : []),
      ]);
  const body = Box({ flexDirection: 'column', gap: 1, overflow: 'hidden' }, [
    log,
    ...(plan.compactBank ? [inset(bankLine(view))] : [inset(sectionTitle('bank')), inset(bankRow(view))]),
    inset(playersTable(players, plan.playerRowGap)),
  ]);
  return Box({ position: 'absolute', top: 0, right: 0, bottom: 0, width: RAIL_W, overflow: 'hidden' }, [
    Sidebar({ width: RAIL_W, height: { pct: 100 }, title: ISLANDERS_RAIL_TITLE, closeId: 'islanders-sidebar-close', onClose, background: uiChromeBg(0.9), titleColor: ARCADE_CHROME_TEXT.title }, [body]),
  ]);
}

// TEMPORARY (testing): left-click a hand card to add one of that resource, right-click to spend
// one, and the count floors at zero. Both write module state through the workbench setters rather
// than the `view` handed in, which is rebuilt every frame — mutating that would last exactly until
// the next repaint. Delete this and the wrappers in `handPanel` once a live IslandersState feeds the
// HUD, since the rules engine is the only thing allowed to move cards then.
function adjustHand(resource: Resource, ev: PointerHit): boolean {
  if (ev.type !== 'down') return false;
  return adjustIslandersWorkbenchHand(resource, ev.button === 2 ? -1 : 1);
}

// Development cards are acquired only through the paid deck action. A held playable card commits
// on left-click and then waits for its board/resource choices; victory points remain passive.
function playDevHand(
  type: DevCardType,
  ev: PointerHit,
  onPlayDevelopmentCard?: IslandersDevelopmentPlayRequest,
): boolean {
  if (ev.type !== 'down' || ev.button === 2 || type === 'victoryPoint') return false;
  return onPlayDevelopmentCard?.(type) ?? beginIslandersWorkbenchDevelopmentPlay(type);
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
    pressed: ISLANDERS_CARD.actionPressed,
  },
  active = false,
): Node {
  const ink: Rgb = enabled ? ISLANDERS_CARD.actionInk : ACTION_DISABLED_INK;
  // Two words (no glyph row) read as one left-aligned block, so the shorter is padded to the
  // longer before centering. The card is an odd number of cells wide, so odd-width rows center
  // exactly and even-width rows cannot; a trailing space makes those odd and settles them one
  // cell left of center, where a wide glyph reads as placed rather than nudged right.
  const wordy = !/\p{Emoji_Presentation}/u.test(icon);
  const block = wordy ? Math.max(stringWidth(icon), stringWidth(label)) : 0;
  const settle = (text: string): string => {
    const padded = text.padEnd(Math.max(block, text.length));
    return stringWidth(padded) % 2 === 0 ? `${padded} ` : padded;
  };
  const content = (): Node[] => [
    Text({ text: settle(icon), style: { color: ink, bold: true } }),
    Text({ text: settle(label), style: { color: ink, bold: true } }),
  ];
  const button = Button({
    id,
    label: '',
    onClick,
    disabled: !enabled,
    style: {
      width: HAND_ACTION_W,
      height: CARD_H,
      padding: 0,
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: active ? colors.pressed : colors.background,
      color: ISLANDERS_CARD.actionInk,
      bold: true,
      hover: { background: colors.hover, color: ISLANDERS_CARD.actionHoverInk },
      focus: { background: colors.hover, color: ISLANDERS_CARD.actionHoverInk },
      pressed: { background: colors.pressed, color: ISLANDERS_CARD.actionPressedInk },
      disabled: active
        ? { background: colors.pressed, color: ISLANDERS_CARD.actionPressedInk, bold: true }
        : { background: ACTION_DISABLED, color: ACTION_DISABLED_INK, bold: false },
    },
  });
  button.children = content();
  return button;
}

function canBuyWorkbenchDev(view: IslandersCardsView): boolean {
  return view.maritimeTradeBusy !== true
    && (view.developmentDeckAvailable ?? view.developmentDeck) > 0
    && RESOURCE_ORDER.every((resource) => view.hand[resource] >= COSTS.devCard[resourceIndex(resource)]);
}

function canOpenWorkbenchTrade(view: IslandersCardsView): boolean {
  return view.maritimeTradeBusy !== true
    && RESOURCE_ORDER.some((resource) => view.hand[resource] > 0);
}

function visibleDevelopmentCardTypes(view: IslandersCardsView, avail: number, showActions: boolean): readonly DevCardType[] {
  const held = DEV_CARD_TYPES.filter((type) => view.devHand[type] > 0
    || view.pendingDevelopmentCards?.includes(type)
    || view.developmentPlay?.type === type);
  const allWorkbenchTypesFit = avail >= RESOURCE_HAND_W + devHandWidth(DEV_CARD_TYPES.length)
    + (showActions ? HAND_ACTION_GAP + ACTIONS_W : 0);
  return view.source === 'workbench' && allWorkbenchTypesFit ? DEV_CARD_TYPES : held;
}

function tradeCardButton(
  resource: Resource,
  count: number | null,
  enabled: boolean,
  onPick: () => void,
  selected = false,
): Node {
  const face = card(RESOURCE_LOOK[resource], count, CARD_H, !enabled, selected);
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

function tradeStagedRow(
  staged: Record<Resource, number>,
  placeholderGlyph: '↑' | '↓',
  onRemove: (resource: Resource) => void,
): Node {
  return Box({ width: TRADE_ROW_W, gap: 1 }, RESOURCE_ORDER.map((resource) => {
    const count = staged[resource];
    if (count === 0) {
      return Box({
        width: CARD_W,
        height: CARD_H,
        background: TRADE_SLOT_BG,
      }, [Box({
        position: 'absolute',
        top: placeholderGlyph === '↑' ? 2 : 1,
        left: Math.floor(CARD_W / 2),
        width: 1,
        height: 1,
      }, [Text({ text: placeholderGlyph, style: { color: ACTION_DISABLED_INK } })])]);
    }
    return tradeCardButton(resource, count, true, () => onRemove(resource));
  }));
}

function tradeBankSourceRow(
  bank: Record<Resource, number>,
  staged: Record<Resource, number>,
  onPick: (resource: Resource) => void,
): Node {
  return Box({ width: TRADE_ROW_W, gap: 1 }, RESOURCE_ORDER.map((resource) => {
    const remaining = bank[resource] - staged[resource];
    return tradeCardButton(resource, null, remaining > 0, () => onPick(resource));
  }));
}

// A shade lighter, for a hover on a filled card.
function lighten(color: Rgb, amount: number): Rgb {
  return [0, 1, 2].map((i) => Math.round(color[i] + (255 - color[i]) * amount)) as Rgb;
}

function tradeActionButton(
  id: string,
  icon: string,
  label: string,
  enabled: boolean,
  onClick: () => void,
  colors?: WorkbenchActionColors,
  active = false,
): Node {
  return workbenchActionButton(id, icon, label, enabled, onClick, colors, active);
}

function tradeDisabledReason(enabled: boolean, reason: string, trigger: Node): Node {
  return enabled ? trigger : Tooltip({ content: reason, maxWidth: 30 }, trigger);
}

type IslandersMaritimeTradeRequest = (via: 'bank' | 'port') => boolean;

export interface IslandersTradeEditorController {
  mode: 'standard' | 'counter';
  give: Record<Resource, number>;
  receive: Record<Resource, number>;
  hasPort: boolean;
  canBank: boolean;
  canPort: boolean;
  canPlayer: boolean;
  canCounter: boolean;
  activeAction?: 'bank' | 'port' | 'player' | 'counter';
  readOnly?: boolean;
  onAdjust(side: 'give' | 'receive', resource: Resource, delta: -1 | 1): boolean;
  onBank(): boolean;
  onPort(): boolean;
  onPlayer(): boolean;
  onCounter(): boolean;
  onClose(): void;
}

export interface IslandersDiscardEditorController {
  required: number;
  selected: Record<Resource, number>;
  canSubmit: boolean;
  onAdjust(resource: Resource, delta: -1 | 1): boolean;
  onSubmit(): boolean;
}

export interface IslandersPlayerTradeOffersController {
  offers: IslandersPlayerTradeOffer[];
  onComplete?(offerId: number, playerName: string): boolean;
  onCancel?(offerId: number): boolean;
  responsePlayer?: IslandersCardsPlayerView;
  activeResponse?: 'accept' | 'counter' | 'reject';
  activeCompletePlayer?: string;
  activeCancel?: boolean;
  onAccept?(offerId: number): boolean;
  onCounter?(offerId: number): boolean;
  onReject?(offerId: number): boolean;
  onWithdrawCounter?(playerName: string): boolean;
  onChange?(): void;
}

function isYou(player: IslandersCardsPlayerView): boolean {
  return player.name.toLowerCase() === 'you';
}

function playerIs(player: IslandersCardsPlayerView, phrase: string): string {
  return isYou(player) ? `You are ${phrase}` : `${player.name} is ${phrase}`;
}

function workbenchTradeController(
  view: IslandersCardsView,
  onChange: () => void,
  onMaritimeTrade?: IslandersMaritimeTradeRequest,
): IslandersTradeEditorController {
  const changed = (action: () => boolean): boolean => {
    const result = action();
    if (result) onChange();
    return result;
  };
  return {
    mode: 'standard',
    give: workbenchTradeGive,
    receive: workbenchTradeGet,
    hasPort: Object.values(view.maritimePortRates).some((rates) => rates.length > 0),
    canBank: stagedIslandersBankTrade() !== null,
    canPort: stagedIslandersPortTrade(view.maritimePortRates) !== null,
    canPlayer: stagedIslandersPlayerTradeValid(),
    canCounter: false,
    onAdjust: (side, resource, delta) => changed(() => adjustIslandersWorkbenchTradeStaging(side, resource, delta)),
    onBank: () => changed(() => onMaritimeTrade?.('bank') ?? performStagedIslandersWorkbenchBankTrade()),
    onPort: () => changed(() => onMaritimeTrade?.('port') ?? performStagedIslandersWorkbenchPortTrade(view.maritimePortRates)),
    onPlayer: () => changed(() => createIslandersWorkbenchPlayerTrade(view.localPlayer, view.opponents, onChange) !== null),
    onCounter: () => false,
    onClose: () => {
      setIslandersTradeEditorOpen(false);
      onChange();
    },
  };
}

function tradeEditor(view: IslandersCardsView, controller: IslandersTradeEditorController): Node {
  const bankAction = tradeDisabledReason(controller.canBank, '4:1 ratio required.', tradeActionButton(
    'islanders-trade-confirm',
    '🏦',
    'bank',
    controller.canBank,
    () => { controller.onBank(); },
    undefined,
    controller.activeAction === 'bank',
  ));
  const portAction = !controller.hasPort
    ? Box({ width: HAND_ACTION_W, height: CARD_H })
    : tradeDisabledReason(controller.canPort, 'Matching port ratio required.', tradeActionButton(
        'islanders-port-trade-confirm',
        '⛵',
        'port',
        controller.canPort,
        () => { controller.onPort(); },
        undefined,
        controller.activeAction === 'port',
      ));
  const playerAction = controller.mode === 'counter'
    ? tradeDisabledReason(controller.canCounter, 'Valid counteroffer required.',
        tradeActionButton('islanders-trade-counter', '↗', 'counter', controller.canCounter, () => { controller.onCounter(); }, undefined, controller.activeAction === 'counter'))
    : tradeDisabledReason(controller.canPlayer, 'Offer and request required.',
        tradeActionButton('islanders-player-trade', '👥', 'player', controller.canPlayer, () => { controller.onPlayer(); }, undefined, controller.activeAction === 'player'));
  const closeAction = controller.readOnly
    ? Box({ width: HAND_ACTION_W, height: CARD_H })
    : tradeActionButton('islanders-trade-close', '×', 'close', true, () => { controller.onClose(); });
  const actionRows = controller.mode === 'counter'
    ? [
        Box({ width: HAND_ACTION_W, height: CARD_H }),
        Box({ width: HAND_ACTION_W, height: CARD_H }),
        playerAction,
        closeAction,
      ]
    : [portAction, bankAction, playerAction, closeAction];
  return Box({
    position: 'absolute',
    left: HAND_PANEL_LEFT,
    bottom: 1,
    width: TRADE_PANEL_W,
    gap: HAND_ACTION_GAP,
  }, [
    Box({
      width: TRADE_TABLE_W,
      height: TRADE_PANEL_H,
      flexDirection: 'column',
      gap: TRADE_ROW_GAP,
      padding: [1, 2],
      background: TRADE_BG,
    }, [
      tradeBankSourceRow(view.bank, controller.receive, (resource) => { controller.onAdjust('receive', resource, 1); }),
      tradeStagedRow(controller.receive, '↓', (resource) => { controller.onAdjust('receive', resource, -1); }),
      tradeStagedRow(controller.give, '↑', (resource) => { controller.onAdjust('give', resource, -1); }),
      tradeSourceRow(view.hand, controller.give, (resource) => { controller.onAdjust('give', resource, 1); }),
    ]),
    Box({
      width: HAND_ACTION_W,
      height: TRADE_PANEL_H,
      flexDirection: 'column',
      gap: TRADE_ROW_GAP,
      padding: [TRADE_PANEL_PAD_V, 0],
    }, actionRows),
  ]);
}

function workbenchDiscardController(
  onChange: () => void,
  onSubmit?: () => boolean,
): IslandersDiscardEditorController | undefined {
  if (!islandersWorkbenchDiscardOpen()) return undefined;
  const changed = (action: () => boolean): boolean => {
    const result = action();
    if (result) onChange();
    return result;
  };
  return {
    required: islandersWorkbenchDiscardRequired(),
    selected: workbenchDiscardSelection,
    canSubmit: canSubmitIslandersWorkbenchDiscard(),
    onAdjust: (resource, delta) => changed(() => adjustIslandersWorkbenchDiscard(resource, delta)),
    onSubmit: () => changed(() => onSubmit?.() ?? submitIslandersWorkbenchDiscard()),
  };
}

function discardEditor(view: IslandersCardsView, controller: IslandersDiscardEditorController): Node {
  const selected = RESOURCE_ORDER.reduce((sum, resource) => sum + controller.selected[resource], 0);
  const submit = tradeDisabledReason(
    controller.canSubmit,
    `Select exactly ${controller.required} cards.`,
    tradeActionButton(
      'islanders-discard-confirm',
      `${selected}/${controller.required}`,
      'discard',
      controller.canSubmit,
      () => { controller.onSubmit(); },
    ),
  );
  return Box({
    position: 'absolute',
    left: HAND_PANEL_LEFT,
    bottom: 1,
    width: TRADE_PANEL_W,
    gap: HAND_ACTION_GAP,
  }, [
    Box({
      width: TRADE_TABLE_W,
      height: DISCARD_PANEL_H,
      flexDirection: 'column',
      gap: TRADE_ROW_GAP,
      padding: [TRADE_PANEL_PAD_V, 2],
      background: TRADE_BG,
    }, [
      tradeStagedRow(controller.selected, '↑', (resource) => { controller.onAdjust(resource, -1); }),
      tradeSourceRow(view.hand, controller.selected, (resource) => { controller.onAdjust(resource, 1); }),
    ]),
    Box({
      width: HAND_ACTION_W,
      height: DISCARD_PANEL_H,
      flexDirection: 'column',
      gap: TRADE_ROW_GAP,
      padding: [TRADE_PANEL_PAD_V, 0],
    }, [
      submit,
      Box({ width: HAND_ACTION_W, height: CARD_H }),
    ]),
  ]);
}

function playerTradeCards(counts: Record<Resource, number>): Node {
  const resources = RESOURCE_ORDER.filter((resource) => counts[resource] > 0);
  return Box({ height: 1, gap: PLAYER_TRADE_TOKEN_GAP, alignItems: 'center' }, resources.map((resource) => {
    const look = RESOURCE_LOOK[resource];
    const count = counts[resource];
    return Box({ height: 1, gap: 1, alignItems: 'center' }, [
      Text({ text: look.emoji, style: { width: 2 } }),
      Text({ text: `x${count}`, style: { color: RAIL_TEXT } }),
    ]);
  }));
}

function playerTradeDecision(
  offer: IslandersPlayerTradeOffer,
  reaction: IslandersPlayerTradeOffer['reactions'][number],
  controller: IslandersPlayerTradeOffersController,
): Node {
  const pending = reaction.status === 'pending';
  const accepted = reaction.status === 'accepted';
  const countered = reaction.status === 'countered';
  const completable = accepted;
  const active = controller.activeCompletePlayer === reaction.player.name;
  const glyph = pending ? '...' : accepted ? '✓' : countered ? '↗' : 'X';
  const detail = pending
    ? `${playerIs(reaction.player, 'deciding')}.`
    : accepted
      ? isYou(reaction.player)
        ? `You accepted. ${isYou(offer.offerer) ? 'Complete the trade.' : `${offer.offerer.name} decides.`}`
        : isYou(offer.offerer)
          ? `Complete the trade with ${reaction.player.name}.`
          : `${reaction.player.name} accepted. ${offer.offerer.name} decides.`
      : countered
        ? `${isYou(reaction.player) ? 'You' : reaction.player.name} countered (the card below).`
      : `${isYou(reaction.player) ? 'You rejected' : `${reaction.player.name} rejected`} the offer.`;
  const button = Button({
    id: `islanders-player-trade-${offer.id}-${reaction.player.name}`,
    label: '',
    disabled: controller.onComplete === undefined,
    onClick: () => {
      if (completable && controller.onComplete?.(offer.id, reaction.player.name)) controller.onChange?.();
    },
    style: {
      width: PLAYER_TRADE_DECISION_W,
      height: PLAYER_TRADE_DECISION_H,
      padding: 0,
      alignItems: 'center',
      justifyContent: 'center',
      background: active ? ISLANDERS_CARD.actionPressed : PLAYER_LOOK[reaction.player.color],
      color: ISLANDERS_CARD.actionInk,
      bold: true,
      hover: completable ? { background: ISLANDERS_CARD.actionHover, color: ISLANDERS_CARD.actionHoverInk } : {},
      pressed: completable ? { background: ISLANDERS_CARD.actionPressed, color: ISLANDERS_CARD.actionPressedInk } : {},
      disabled: {
        background: active ? ISLANDERS_CARD.actionPressed : PLAYER_LOOK[reaction.player.color],
        color: ISLANDERS_CARD.actionInk,
      },
    },
  });
  button.children = [Box({ width: PLAYER_TRADE_DECISION_W, height: PLAYER_TRADE_DECISION_H, alignItems: 'center', justifyContent: 'center' }, [
    Text({ text: glyph, style: { color: ISLANDERS_CARD.actionInk, bold: true } }),
  ])];
  return Tooltip({
    id: `islanders-player-trade-${offer.id}-${reaction.player.name}-help`,
    content: [{ text: reaction.player.name, bold: true }, detail],
    maxWidth: 38,
  }, button);
}

function playerTradeResponseButton(
  offer: IslandersPlayerTradeOffer,
  controller: IslandersPlayerTradeOffersController,
  kind: 'accept' | 'counter' | 'reject',
): Node {
  const glyph = kind === 'accept' ? '✓' : kind === 'counter' ? '↗' : 'X';
  const action = kind === 'accept' ? controller.onAccept : kind === 'counter' ? controller.onCounter : controller.onReject;
  const player = controller.responsePlayer;
  const active = controller.activeResponse === kind;
  const button = Button({
    id: `islanders-player-trade-${offer.id}-${kind}`,
    label: '',
    disabled: action === undefined,
    onClick: () => {
      if (action?.(offer.id)) controller.onChange?.();
    },
    style: {
      width: PLAYER_TRADE_DECISION_W,
      height: PLAYER_TRADE_DECISION_H,
      padding: 0,
      alignItems: 'center',
      justifyContent: 'center',
      background: active ? ISLANDERS_CARD.actionPressed : player ? PLAYER_LOOK[player.color] : ISLANDERS_CARD.actionBg,
      color: ISLANDERS_CARD.actionInk,
      bold: true,
      hover: { background: ISLANDERS_CARD.actionHover, color: ISLANDERS_CARD.actionHoverInk },
      pressed: { background: ISLANDERS_CARD.actionPressed, color: ISLANDERS_CARD.actionPressedInk },
      disabled: {
        background: active ? ISLANDERS_CARD.actionPressed : player ? PLAYER_LOOK[player.color] : ISLANDERS_CARD.actionBg,
        color: ISLANDERS_CARD.actionInk,
      },
    },
  });
  button.children = [Box({ width: PLAYER_TRADE_DECISION_W, height: PLAYER_TRADE_DECISION_H, alignItems: 'center', justifyContent: 'center' }, [
    Text({ text: glyph, style: { color: ISLANDERS_CARD.actionInk, bold: true } }),
  ])];
  return Tooltip({
    id: `islanders-player-trade-${offer.id}-${kind}-help`,
    content: [{ text: `${kind[0].toUpperCase()}${kind.slice(1)} trade`, bold: true }],
    maxWidth: 30,
  }, button);
}

// One exchange line of a trade card: who (the crowd, or a seat's color square), which way the
// cards flow for the card's owner (↓ incoming, ↑ outgoing), and the cards.
function exchangeRow(mark: { glyph: string; color: Rgb }, arrow: '↓' | '↑', counts: Record<Resource, number>): Node {
  return Box({ height: PLAYER_TRADE_ROW_H, gap: 1, alignItems: 'center' }, [
    Box({ width: PLAYER_TRADE_IDENTITY_W, height: PLAYER_TRADE_ROW_H, gap: 1, alignItems: 'center' }, [
      Text({ text: mark.glyph, style: { color: mark.color, bold: true } }),
      Text({ text: arrow, style: { color: mark.color, bold: true } }),
    ]),
    playerTradeCards(counts),
  ]);
}

// The trade card's frame: the incoming line, then the outgoing line with the decisions at its
// right. A posted offer and a counter to it are the same object, so they share this.
function tradeCard(incoming: Node, outgoing: Node, decisions: Node): Node {
  return Box({
    height: PLAYER_TRADE_H,
    flexDirection: 'column',
    alignItems: 'stretch',
    padding: [0, 1, 1, 1],
    background: TRADE_BG,
    overflow: 'hidden',
  }, [
    incoming,
    Box({ height: PLAYER_TRADE_ROW_H, alignItems: 'end', justifyContent: 'between', gap: 2 }, [outgoing, decisions]),
  ]);
}

// A decision-slot button (the ✓ / X / ... squares at a trade card's right edge).
function decisionButton(id: string, glyph: string, background: Rgb, onClick: () => void, tooltip: string, hover?: Rgb): Node {
  const button = Button({
    id,
    label: '',
    onClick,
    style: {
      width: PLAYER_TRADE_DECISION_W,
      height: PLAYER_TRADE_DECISION_H,
      padding: 0,
      alignItems: 'center',
      justifyContent: 'center',
      background,
      color: ISLANDERS_CARD.actionInk,
      bold: true,
      hover: { background: hover ?? ISLANDERS_CARD.actionHover, color: ISLANDERS_CARD.actionHoverInk },
      pressed: { background: ISLANDERS_CARD.actionPressed, color: ISLANDERS_CARD.actionPressedInk },
    },
  });
  button.children = [Box({ width: PLAYER_TRADE_DECISION_W, height: PLAYER_TRADE_DECISION_H, alignItems: 'center', justifyContent: 'center' }, [
    Text({ text: glyph, style: { color: ISLANDERS_CARD.actionInk, bold: true } }),
  ])];
  return Tooltip({ id: `${id}-help`, content: [{ text: tooltip, bold: true }], maxWidth: 34 }, button);
}

function playerTradeOffer(offer: IslandersPlayerTradeOffer, controller: IslandersPlayerTradeOffersController): Node {
  const cancelButton = Button({
    id: `islanders-player-trade-${offer.id}-cancel`,
    label: '',
    disabled: controller.onCancel === undefined,
    onClick: () => {
      if (controller.onCancel?.(offer.id)) controller.onChange?.();
    },
    style: {
      width: PLAYER_TRADE_DECISION_W,
      height: PLAYER_TRADE_DECISION_H,
      padding: 0,
      alignItems: 'center',
      justifyContent: 'center',
      background: controller.activeCancel ? ISLANDERS_CARD.actionPressed : ISLANDERS_CARD.cancelBg,
      color: ISLANDERS_CARD.actionInk,
      bold: true,
      hover: { background: ISLANDERS_CARD.cancelHover, color: ISLANDERS_CARD.actionHoverInk },
      pressed: { background: ISLANDERS_CARD.actionPressed, color: ISLANDERS_CARD.actionPressedInk },
      disabled: {
        background: controller.activeCancel ? ISLANDERS_CARD.actionPressed : ISLANDERS_CARD.cancelBg,
        color: ISLANDERS_CARD.actionInk,
      },
    },
  });
  cancelButton.children = [Box({ width: PLAYER_TRADE_DECISION_W, height: PLAYER_TRADE_DECISION_H, alignItems: 'center', justifyContent: 'center' }, [
    Text({ text: 'x', style: { color: ISLANDERS_CARD.actionInk, bold: true } }),
  ])];
  const cancel = Tooltip({
    id: `islanders-player-trade-${offer.id}-cancel-help`,
    content: [{ text: 'Cancel player trade', bold: true }, 'Withdraw this offer from every player.'],
    maxWidth: 34,
  }, cancelButton);
  const decisions = Box({
    height: PLAYER_TRADE_DECISION_H,
    gap: 1,
  }, [
    ...offer.reactions.map((reaction) => playerTradeDecision(offer, reaction, controller)),
    ...(controller.onAccept ? [playerTradeResponseButton(offer, controller, 'accept')] : []),
    ...(controller.onCounter ? [playerTradeResponseButton(offer, controller, 'counter')] : []),
    ...(controller.onReject ? [playerTradeResponseButton(offer, controller, 'reject')] : []),
    ...(!controller.onAccept && controller.activeResponse ? [playerTradeResponseButton(offer, controller, controller.activeResponse)] : []),
    ...(controller.onCancel || controller.activeCancel ? [cancel] : []),
  ]);
  const offerer = { glyph: '■', color: PLAYER_LOOK[offer.offerer.color] };
  return tradeCard(
    exchangeRow({ glyph: '👥', color: ISLANDERS_CARD.tradeAccent }, '↓', offer.get),
    exchangeRow(offerer, '↑', offer.give),
    decisions,
  );
}

// A counter is drawn as a trade card of its own, from the counterer's side: the poster's color
// square where the crowd was (the cards come from them), the counterer's square on the give
// line. Only the poster decides — accept completes the trade with the counterer — and the
// counterer can withdraw it.
function playerCounterOffer(
  offer: IslandersPlayerTradeOffer,
  reaction: IslandersPlayerTradeOffer['reactions'][number],
  controller: IslandersPlayerTradeOffersController,
): Node | null {
  if (reaction.status !== 'countered' || !reaction.counterGive || !reaction.counterGet) return null;
  const counterer = reaction.player;
  const idBase = `islanders-player-trade-${offer.id}-${counterer.name}-counter`;
  const decisions = Box({ height: PLAYER_TRADE_DECISION_H, gap: 1 }, [
    ...(controller.onComplete
      ? [decisionButton(`${idBase}-accept`, '✓', PLAYER_LOOK[counterer.color], () => {
          if (controller.onComplete?.(offer.id, counterer.name)) controller.onChange?.();
        }, `Trade with ${counterer.name}`)]
      : []),
    ...(isYou(counterer) && controller.onWithdrawCounter
      ? [decisionButton(`${idBase}-withdraw`, 'x', ISLANDERS_CARD.cancelBg, () => {
          if (controller.onWithdrawCounter?.(counterer.name)) controller.onChange?.();
        }, 'Withdraw your counter', ISLANDERS_CARD.cancelHover)]
      : []),
  ]);
  return tradeCard(
    exchangeRow({ glyph: '■', color: PLAYER_LOOK[offer.offerer.color] }, '↓', reaction.counterGet),
    exchangeRow({ glyph: '■', color: PLAYER_LOOK[counterer.color] }, '↑', reaction.counterGive),
    decisions,
  );
}

function playerTradeOffers(right: number, controller: IslandersPlayerTradeOffersController): Node | null {
  const offers = controller.offers;
  if (offers.length === 0) return null;
  return Box({
    position: 'absolute',
    top: 3,
    right,
    flexDirection: 'column',
    alignItems: 'end',
    gap: 1,
  }, offers.flatMap((offer) => [
    playerTradeOffer(offer, controller),
    ...offer.reactions
      .map((reaction) => playerCounterOffer(offer, reaction, controller))
      .filter((node): node is Node => node !== null),
  ]));
}

// Bottom-left corner only: the panel hugs its cards instead of spanning the window, so the board
// stays visible across the rest of the bottom row.
// The resource hand and the development hand are two groups of the same card, split by a seam:
// resources are spendable, dev cards are played. Only dev cards actually held are drawn, so the
// panel grows and shrinks with the hand instead of showing five mostly-empty purple slots.
type IslandersDevelopmentPurchaseRequest = () => boolean;
type IslandersDevelopmentPlayRequest = (type: DevCardType) => boolean;
type IslandersDevelopmentResourceRequest = (resource: Resource) => boolean;

export interface IslandersHandActionController {
  canTrade: boolean;
  canBuyDevelopmentCard: boolean;
  activeAction?: 'trade' | 'buyDev';
  onTrade(): boolean;
  onBuyDevelopmentCard(): boolean;
  // The turn's spine, shown as a third card beside trade and buy dev: roll while the dice are
  // due, end turn once the turn is open. Absent (the workbench, a model's turn) → no card.
  turn?: { kind: 'roll' | 'end'; onClick(): boolean };
}

function handPanel(
  view: IslandersCardsView,
  layout: IslandersCardsLayout,
  avail: number,
  onChange: () => void,
  onBuyDevelopmentCard?: IslandersDevelopmentPurchaseRequest,
  onPlayDevelopmentCard?: IslandersDevelopmentPlayRequest,
  onChooseDevelopmentResource?: IslandersDevelopmentResourceRequest,
  liveActionController?: IslandersHandActionController,
): Node {
  const height = layout.compact ? CARD_H_COMPACT : CARD_H;
  const actionController: IslandersHandActionController | undefined = liveActionController
    ?? (view.source === 'workbench'
      ? {
          canTrade: canOpenWorkbenchTrade(view),
          canBuyDevelopmentCard: canBuyWorkbenchDev(view),
          onTrade: () => {
            setIslandersTradeEditorOpen(!islandersTradeEditorOpen());
            onChange();
            return true;
          },
          onBuyDevelopmentCard: () => {
            const bought = onBuyDevelopmentCard?.() ?? buyIslandersWorkbenchDevCard();
            if (bought) onChange();
            return bought;
          },
        }
      : undefined);
  const showActions = actionController !== undefined && avail >= RESOURCE_HAND_W + HAND_ACTION_GAP + ACTIONS_W;
  // Wide workbench views retain all five authored placeholders. When the sidebar narrows the
  // hand, keep only cards actually held (plus the in-flight destination), so a purchased card
  // remains visible instead of losing its landing slot to empty test-bed placeholders.
  const visibleDevTypes = visibleDevelopmentCardTypes(view, avail, showActions);
  const visibleDevWidth = devHandWidth(visibleDevTypes.length);
  const showDev = visibleDevTypes.length > 0
    && avail >= RESOURCE_HAND_W + visibleDevWidth + (showActions ? HAND_ACTION_GAP + ACTIONS_W : 0);
  // A card is wrapped in its own click target only in the workbench view. In the live game
  // the wrapper is skipped entirely, so the hit-test finds nothing interactive over the hand and
  // a click falls through to the board exactly as it did before the cards existed.
  const clickable = (face: Node, onMouse: (ev: PointerHit) => boolean, enabled = true, allowLive = false, fill?: Rgb): Node => {
    if ((view.source !== 'workbench' && !allowLive) || !enabled) return face;
    // The wrapper carries the handler so `card` stays presentational. The hit-test takes the
    // innermost INTERACTIVE node and the face has none, so it never competes; `Box` has no
    // handler slot, hence attaching it to the node. With `fill` the wrapper also paints the
    // card's color and lightens it a touch under the pointer (see `card`'s `hoverable`).
    const hit = Box({ width: CARD_W, height, ...(fill ? { background: fill, hover: { background: lighten(fill, 0.12) } } : {}) }, [face]);
    hit.onMouse = onMouse;
    return hit;
  };
  const devCards = !showDev
    ? []
    : visibleDevTypes.map((type) => {
        // A pending purchase can add this type to a narrow hand solely to reserve its landing
        // slot. Keep that zero-count slot in the normal disabled treatment for the entire flight;
        // it becomes a purple held card only when landing credits the hand count.
        const held = view.devHand[type] > 0 || view.developmentPlay?.type === type;
        const hold = held ? view.developmentCardHolds?.[type] : undefined;
        return Tooltip({
          id: `islanders-dev-${type}`,
          content: [
            { text: DEV_CARD_HELP[type].title, bold: true },
            DEV_CARD_HELP[type].effect,
            ...(hold ? [{ text: hold, color: RAIL_MUTED }] : []),
          ],
          maxWidth: 46,
          // A touch lighter purple under the pointer, never the tooltip's default white pill.
          hover: { background: lighten(held ? DEV_HAND_LOOK[type].fill : EMPTY_FILL, 0.12), color: undefined, bold: false },
        }, (() => {
          const playable = view.devHand[type] > 0
            && type !== 'victoryPoint'
            && view.maritimeTradeBusy !== true
            && view.developmentPlay === undefined
            && (view.source === 'workbench' || view.playableDevelopmentCards?.includes(type as Exclude<DevCardType, 'victoryPoint'>) === true);
          const live = onPlayDevelopmentCard !== undefined;
          const hoverable = playable && (view.source === 'workbench' || live);
          return clickable(
            card(
              DEV_HAND_LOOK[type],
              view.devHand[type],
              height,
              view.devHand[type] === 0 && view.developmentPlay?.type !== type,
              view.developmentPlay?.type === type,
              hoverable,
            ),
            (ev) => playDevHand(type, ev, onPlayDevelopmentCard),
            playable,
            live,
            hoverable ? DEV_HAND_LOOK[type].fill : undefined,
          );
        })());
      });
  const cards = RESOURCE_ORDER.map((resource) => clickable(
    card(RESOURCE_LOOK[resource], view.hand[resource], height, view.hand[resource] === 0),
    (ev) => {
      if (view.developmentPlay?.type === 'yearOfPlenty' || view.developmentPlay?.type === 'monopoly') {
        if (ev.type !== 'down' || ev.button === 2) return false;
        return onChooseDevelopmentResource?.(resource) ?? chooseIslandersWorkbenchDevelopmentResource(resource);
      }
      return adjustHand(resource, ev);
    },
    view.maritimeTradeBusy !== true,
  ));
  const actions = !showActions
    ? []
    : [
        Tooltip({
          id: 'islanders-trade',
          content: [
            { text: 'Trade', bold: true },
            'Trade with the bank, a port, or other players.',
          ],
          maxWidth: 34,
        }, workbenchActionButton(
          'islanders-trade-open',
          `${RESOURCE_LOOK.lumber.emoji}⇄${RESOURCE_LOOK.wool.emoji}`,
          'trade',
          actionController.canTrade,
          () => { actionController.onTrade(); },
          undefined,
          actionController.activeAction === 'trade',
        )),
        Tooltip({
          id: 'islanders-buy-dev',
          content: [
            { text: 'Buy development card', bold: true },
            'Costs 🐑 🌾 🪨.',
          ],
          maxWidth: 36,
        }, workbenchActionButton('islanders-buy-dev', `💲 ${DEV_CARD_ICON}`, 'buy dev', actionController.canBuyDevelopmentCard, () => {
          actionController.onBuyDevelopmentCard();
        }, {
          background: DEV_LOOK.fill,
          hover: ISLANDERS_CARD.devActionHover,
          pressed: ISLANDERS_CARD.devActionPressed,
        }, actionController.activeAction === 'buyDev')),
        ...(actionController.turn
          ? [actionController.turn.kind === 'roll'
              ? workbenchActionButton('islanders-live-roll', 'roll', 'dice', true, () => { actionController.turn?.onClick(); }, TURN_ACTION_COLORS)
              : workbenchActionButton('islanders-live-end', 'end', 'turn', true, () => { actionController.turn?.onClick(); }, TURN_ACTION_COLORS)]
          : []),
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

function developmentPrompt(view: IslandersCardsView, layout: IslandersCardsLayout): Node | null {
  const play = view.developmentPlay;
  if (!play) return null;
  const instruction = play.type === 'knight'
    ? 'choose a robber tile'
    : play.type === 'roadBuilding'
      ? `place ${play.remaining} road${play.remaining === 1 ? '' : 's'}`
      : play.type === 'yearOfPlenty'
        ? `choose ${play.remaining} resource${play.remaining === 1 ? '' : 's'} from your hand row`
        : 'choose a resource from your hand row';
  return Box({
    position: 'absolute',
    left: HAND_PANEL_LEFT,
    bottom: layout.handHeight + 2,
    padding: [0, 1],
    gap: 1,
    background: uiChromeBg(0.9),
    pointerEvents: 'none',
  }, [
    Text({ text: DEV_CARD_HELP[play.type].title, style: { color: DEV_HAND_LOOK[play.type].fill, bold: true } }),
    Text({ text: instruction, style: { color: ARCADE_CHROME_TEXT.body } }),
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
export function islandersHandLandingCell(region: LayoutBox, resource: Resource): { col: number; row: number } {
  const layout = islandersCardsLayout(region);
  const panelTop = region.h - 1 - layout.handHeight;
  const left = HAND_PANEL_LEFT + HAND_PAD_X + RESOURCE_ORDER.indexOf(resource) * (CARD_W + 1);
  return { col: left + Math.floor(CARD_W / 2), row: panelTop + HAND_PAD_T };
}

// A confirmed discard closes its editor before the rules action is applied, but the cards should
// still visibly leave the staged row the player just submitted. Restate that row's anchored
// geometry so playback can start at the selected resource card after the panel disappears.
export function islandersDiscardDepartureCell(region: LayoutBox, resource: Resource): { col: number; row: number } {
  const panelTop = region.y + region.h - 1 - DISCARD_PANEL_H;
  const left = region.x + HAND_PANEL_LEFT + 2 + RESOURCE_ORDER.indexOf(resource) * (CARD_W + 1);
  return {
    col: left + Math.floor(CARD_W / 2),
    row: panelTop + TRADE_PANEL_PAD_V + Math.floor((CARD_H - 2) / 2),
  };
}

// Where an animated bank card leaves its pile. With the sidebar open this is the exact center of
// that resource or dev card. With it hidden, the whole four-cell flight chip starts one cell beyond
// the terminal's right edge at the same roughly two-thirds-down height occupied by the bank row.
function islandersBankPileDepartureCell(
  region: LayoutBox,
  cardIndex: number,
  glyphWidth: number,
  playerCount: number,
  railVisible: boolean,
  composerRows: number,
): { col: number; row: number } {
  if (!railVisible) {
    const flightChipWidth = glyphWidth + 2;
    return {
      col: region.x + region.w + 1 + Math.floor(flightChipWidth / 2),
      row: region.y + Math.floor(region.h * 2 / 3),
    };
  }
  const railLeft = region.x + region.w - RAIL_W;
  const plan = islandersRailPlan(region, playerCount, composerRows);
  if (plan.compactBank) {
    // The glyph sits two cells before the right edge of its pile slot on the bank line.
    const pileRight = railLeft + SIDEBAR_PAD_L + BANK_LINE_LABEL.length + (cardIndex + 1) * BANK_LINE_PILE_W;
    return { col: pileRight - 3, row: region.y + plan.bankTop };
  }
  const cardLeft = railLeft + SIDEBAR_PAD_L + cardIndex * (CARD_W + 1);
  return {
    col: cardLeft + Math.floor(CARD_W / 2),
    row: region.y + plan.bankTop + Math.floor((CARD_H - 2) / 2),
  };
}

export function islandersBankDepartureCell(
  region: LayoutBox,
  resource: Resource,
  playerCount: number,
  railVisible: boolean,
  composerRows = 0,
): { col: number; row: number } {
  return islandersBankPileDepartureCell(
    region,
    RESOURCE_ORDER.indexOf(resource),
    stringWidth(RESOURCE_LOOK[resource].emoji),
    playerCount,
    railVisible,
    composerRows,
  );
}

export function islandersDevDeckDepartureCell(
  region: LayoutBox,
  playerCount: number,
  railVisible: boolean,
  composerRows = 0,
): { col: number; row: number } {
  return islandersBankPileDepartureCell(
    region,
    RESOURCE_ORDER.length,
    stringWidth(DEV_CARD_ICON),
    playerCount,
    railVisible,
    composerRows,
  );
}

export function islandersDevHandLandingCell(
  region: LayoutBox,
  type: DevCardType,
  railVisible: boolean,
  view: IslandersCardsView,
): { col: number; row: number } {
  const layout = islandersCardsLayout(region);
  const avail = region.w - (railVisible ? RAIL_W : 0) - 2;
  // Live human games use the same two-card action rail as the workbench. A development-card
  // flight can only target this hand after a live purchase, so reserve the rail width here too.
  const showActions = avail >= RESOURCE_HAND_W + HAND_ACTION_GAP + ACTIONS_W;
  const visibleTypes = visibleDevelopmentCardTypes(view, avail, showActions);
  return islandersDevHandLandingCellForTypes(region, type, visibleTypes);
}

export function islandersDevHandLandingCellForTypes(
  region: LayoutBox,
  type: DevCardType,
  visibleTypes: readonly DevCardType[],
): { col: number; row: number } {
  const layout = islandersCardsLayout(region);
  const index = Math.max(0, visibleTypes.indexOf(type));
  const panelTop = region.h - 1 - layout.handHeight;
  const left = HAND_PANEL_LEFT + HAND_PAD_X + TRADE_ROW_W + HAND_SPLIT_GAP + index * (CARD_W + 1);
  return { col: left + Math.floor(CARD_W / 2), row: panelTop + HAND_PAD_T };
}

export function buildIslandersCardsOverlay(
  region: LayoutBox,
  onCloseSidebar: () => void,
  view: IslandersCardsView = islandersWorkbenchView(),
  onWorkbenchChange: () => void = () => {},
  onMaritimeTrade?: IslandersMaritimeTradeRequest,
  onBuyDevelopmentCard?: IslandersDevelopmentPurchaseRequest,
  onPlayDevelopmentCard?: IslandersDevelopmentPlayRequest,
  onChooseDevelopmentResource?: IslandersDevelopmentResourceRequest,
  liveTradeController?: IslandersTradeEditorController,
  liveActionController?: IslandersHandActionController,
  onWorkbenchDiscard?: () => boolean,
  liveDiscardController?: IslandersDiscardEditorController,
  livePlayerTradeController?: IslandersPlayerTradeOffersController,
  logComposer?: Node,
): Node {
  const layout = islandersCardsLayout(region);
  const showSidebar = sidebarOpen && layout.showPublicRail;
  const composerH = typeof logComposer?.style.height === 'number' ? logComposer.style.height : 0;
  const plan = islandersRailPlan(region, view.opponents.length + 1, showSidebar ? composerH : 0);
  if (showSidebar && plan.logH > 0) {
    // Follow-to-bottom: stay pinned to the newest entry unless the reader has scrolled up.
    const viewportH = Math.max(1, plan.logH - composerH - (logComposer ? 1 : 0));
    const rows: Row[] = view.history.flatMap(islandersHistoryRows);
    const atBottom = islandersHistoryScroll.scroll >= Math.max(0, islandersHistoryScroll.rows.length - viewportH);
    islandersHistoryScroll.setHeight(viewportH);
    islandersHistoryScroll.rows = rows;
    const maxScroll = Math.max(0, rows.length - viewportH);
    islandersHistoryScroll.scroll = atBottom ? maxScroll : Math.min(islandersHistoryScroll.scroll, maxScroll);
  }
  const workbench = view.source === 'workbench';
  const offerController = livePlayerTradeController ?? (workbench ? {
    offers: islandersWorkbenchPlayerTradeOffers(),
    onComplete: completeIslandersWorkbenchPlayerTrade,
    onCancel: cancelIslandersWorkbenchPlayerTrade,
    onChange: onWorkbenchChange,
  } : undefined);
  const offers = offerController ? playerTradeOffers((showSidebar ? RAIL_W : 0) + 2, offerController) : null;
  const editorController = liveTradeController
    ?? (workbench && islandersTradeEditorOpen() ? workbenchTradeController(view, onWorkbenchChange, onMaritimeTrade) : undefined);
  const discardController = liveDiscardController
    ?? (workbench ? workbenchDiscardController(onWorkbenchChange, onWorkbenchDiscard) : undefined);
  return Box({ position: 'absolute', top: 0, left: 0, width: region.w, height: region.h }, [
    ...(showSidebar ? [sidebar(view, onCloseSidebar, plan, logComposer)] : []),
    // The hand shares the bottom row with the board, and the rail eats into it. Hand it the
    // width actually left over so it can drop its optional half instead of sliding under the rail.
    ...(discardController
      ? [discardEditor(view, discardController)]
      : editorController
        ? [tradeEditor(view, editorController)]
      : [handPanel(
          view,
          layout,
          region.w - (showSidebar ? RAIL_W : 0) - 2,
          onWorkbenchChange,
          onBuyDevelopmentCard,
          onPlayDevelopmentCard,
          onChooseDevelopmentResource,
          liveActionController,
        )]),
    ...(workbench ? [developmentPrompt(view, layout)].filter((node): node is Node => node !== null) : []),
    ...(offers ? [offers] : []),
  ]);
}
