// The poker game HUD: a small info panel (pot + action log) top-left, a commentary
// toast above the bar, and — on the hero's turn — the betting controls (Fold /
// Check|Call, a raise-amount Slider with Bet/Raise + All-in). Mirrors the chess HUD
// (games/chess/hud.ts): persistent component instances mounted via Slot, rebuilt
// into a full-screen tree each frame. main owns the scene + driver and wires the
// handlers; this module owns the controls and maps the slider to a chip amount.

import { Box, Button, type Row, ScrollBox, Slider, Slot, Text, type LayoutBox, type Node, type Screen, type Style } from '../../../tui/index.ts';
import type { RGB } from '../../../engine/index.ts';
import { type Card, isRed, RANK_LABELS } from '../../../rules/poker/cards.ts';
import type { HeroPanelView } from './poker-scene.ts';
import { ChatBox, type ChatMessage, CHAT_WIDTH, PANEL_PAD_L, PANEL_PAD_R } from '../chess/chat.ts';
import { shortModel } from '../chess/hud.ts';

const LOG_WIDTH = 30;
const LOG_HEIGHT = 14;

// The hero's decision context for this frame (from the live HoldemState). When
// `toAct` is false the betting controls are hidden.
export interface HeroContext {
  toAct: boolean;
  toCall: number; // chips to call (0 → check available)
  minRaiseTo: number; // smallest legal raise total
  maxRaiseTo: number; // all-in total
  stack: number;
  pot: number;
  canRaise: boolean; // maxRaiseTo > current bet (there are chips to raise with)
}

// A transient rationale toast (a model's line before it acts), same shape as chess.
export interface PokerCommentary {
  text: string;
  model: string;
  until: number;
}

export interface PokerGameHandlers {
  onFold(): void;
  onCheckCall(): void;
  onBetRaise(amount: number): void; // raise TO this total
  onAllin(): void;
  onSliderChange(): void; // request a re-render so the amount label follows the thumb
}
let H: PokerGameHandlers | null = null;
export function setPokerGameHandlers(h: PokerGameHandlers): void {
  H = h;
}

export const betSlider = new Slider({ id: 'poker-bet', width: 24, value: 0.5, step: 0.02, onChange: () => H?.onSliderChange() });
export const actionLog = new ScrollBox({ id: 'poker-log', width: LOG_WIDTH, height: LOG_HEIGHT, rows: [], autoHeight: true });
// The chat thread (reuses the chess ChatBox with its own Slot id; same default empty-state
// hint as chess). Each AI's pre-move line is pushed here as in-character table talk that
// never reveals its hole cards.
const pokerChat = new ChatBox('poker-chat');

export function mountPokerGameHud(ui: Screen): void {
  ui.mount(betSlider);
  ui.mount(actionLog);
  ui.mount(pokerChat);
}

// A model's table-talk line → the thread. clear resets it for a fresh session.
export function pushPokerChat(msg: ChatMessage): void {
  pokerChat.push(msg);
}
export function clearPokerChat(): void {
  pokerChat.clear();
}

// The raise-TO total the slider currently selects, mapped from its 0..1 value onto
// [minRaiseTo, maxRaiseTo] and rounded to the big blind for tidy amounts.
export function sliderAmount(hero: HeroContext): number {
  const span = hero.maxRaiseTo - hero.minRaiseTo;
  const raw = hero.minRaiseTo + betSlider.value * span;
  const step = 10; // round to the small blind
  const snapped = Math.round(raw / step) * step;
  return Math.max(hero.minRaiseTo, Math.min(hero.maxRaiseTo, snapped));
}

// Action-history strings → log rows, then refresh the panel (auto-following the tail
// only when already scrolled to the bottom, like the chess move panel).
export function refreshPokerLog(entries: readonly string[]): void {
  const rows: Row[] = entries.map((e) => Box({ width: LOG_WIDTH }, [Text({ text: e, style: { color: 'fg' } })]));
  const prevMax = Math.max(0, actionLog.rows.length - LOG_HEIGHT);
  const atBottom = actionLog.scroll >= prevMax;
  actionLog.rows = rows;
  const newMax = Math.max(0, rows.length - LOG_HEIGHT);
  actionLog.scroll = atBottom ? newMax : Math.min(actionLog.scroll, newMax);
}

const BTN: Style = {
  padding: [0, 2],
  background: [44, 46, 56],
  color: [212, 214, 224],
  bold: true,
  hover: { background: [238, 240, 248], color: [16, 16, 24] },
  focus: { background: [86, 90, 108], color: [248, 248, 252] },
  pressed: { background: [255, 255, 255], color: [12, 12, 18] },
};
const FOLD: Style = { ...BTN, background: [96, 44, 44], color: [246, 220, 218], hover: { background: [150, 58, 58], color: [255, 240, 238] } };
const RAISE: Style = { ...BTN, background: [86, 64, 120], color: [238, 230, 250], hover: { background: [110, 84, 150], color: [248, 244, 255] } };

// The betting controls, shown only on the hero's turn.
function bettingControls(hero: HeroContext): Node {
  const buttons: Node[] = [Button({ id: 'poker-fold', label: 'Fold', onClick: () => H?.onFold(), style: FOLD })];
  buttons.push(
    hero.toCall > 0
      ? Button({ id: 'poker-call', label: hero.toCall >= hero.stack ? `Call ${hero.stack} (all-in)` : `Call ${hero.toCall}`, onClick: () => H?.onCheckCall(), style: BTN })
      : Button({ id: 'poker-check', label: 'Check', onClick: () => H?.onCheckCall(), style: BTN }),
  );

  const rows: Node[] = [Box({ flexDirection: 'row', gap: 2 }, buttons)];
  // A raise/bet control only when the hero has chips beyond the call and there's a
  // real range (min < max). When min == max, only an all-in is possible. The live
  // amount rides ON the confirm button ("Raise to 790" / "Bet 790") — no separate
  // floating amount label, no bare verb-only button.
  if (hero.canRaise) {
    const amount = sliderAmount(hero);
    const verb = hero.toCall > 0 ? 'Raise to' : 'Bet';
    const hasRange = hero.maxRaiseTo > hero.minRaiseTo;
    const raiseRow: Node[] = [];
    if (hasRange) {
      raiseRow.push(Slot('poker-bet'));
      raiseRow.push(Button({ id: 'poker-raise', label: `${verb} ${amount}`, onClick: () => H?.onBetRaise(amount), style: RAISE }));
    }
    raiseRow.push(Button({ id: 'poker-allin', label: `All-in ${hero.maxRaiseTo}`, onClick: () => H?.onAllin(), style: RAISE }));
    rows.push(Box({ flexDirection: 'row', gap: 2, alignItems: 'center' }, raiseRow));
  }
  return Box({ flexDirection: 'column', gap: 1, padding: [1, 2], background: [16, 18, 26, 0.92] }, rows);
}

// ── Right rail: table-talk chat (top) + your hand/board (bottom-right) ──────────────
// A full-height column pinned to the right edge (like the chess chat rail). The table-
// talk thread fills the top; the hand/board panel sits in the bottom-right corner, always
// present while a hand is in play. Hole cards read ?? until the hero peeks them (then rank
// + suit icon), board slots read ? until the flop/turn/river deals them.
const RAIL_W = CHAT_WIDTH; // rail width = chat width, so the hand panel lines up beneath it
const CHAT_PAD_V = 1; // chat panel top/bottom inset
const CHAT_HEADER_H = 2; // header row + a gap row
const HAND_PANEL_H = 7; // title + You row + Board row + 2 gaps + [1] top/bottom padding

const SUIT_ICON = ['♠', '♥', '♦', '♣'] as const; // indexed by Suit (spades, hearts, diamonds, clubs)
const CARD_FACE: RGB = [230, 230, 236]; // light card stock
const CARD_RED: RGB = [196, 30, 40]; // ♥ / ♦
const CARD_BLACK: RGB = [20, 20, 28]; // ♠ / ♣
const CELL_DOWN: RGB = [44, 46, 56]; // face-down / undealt slot
const CELL_DOWN_FG: RGB = [126, 130, 148];
const ROW_LABEL_W = 6; // fixed so the "You"/"Board" rows' cells line up

// One mini-card cell: light stock with rank + suit icon (red for ♥/♦), or a muted slate
// placeholder (`??` for an un-peeked hole card, `?` for an undealt board slot). Ten is
// rendered "T" (poker shorthand) so every card is exactly two chars → a tidy fixed grid.
function cardCell(card: Card | null, placeholder: string): Node {
  if (!card) return Box({ padding: [0, 1], background: CELL_DOWN }, [Text({ text: placeholder, style: { color: CELL_DOWN_FG, bold: true } })]);
  const rank = RANK_LABELS[card.rank] === '10' ? 'T' : RANK_LABELS[card.rank];
  return Box({ padding: [0, 1], background: CARD_FACE }, [Text({ text: `${rank}${SUIT_ICON[card.suit]}`, style: { color: isRed(card) ? CARD_RED : CARD_BLACK, bold: true } })]);
}

const rowLabel = (t: string): Node => Box({ width: ROW_LABEL_W }, [Text({ text: t, style: { color: 'muted' } })]);

// The chat ✕ (collapse) and the reopen pill, mirroring the chess chat affordances.
const CHAT_CLOSE: Style = {
  padding: [0, 1],
  color: [150, 154, 166],
  hover: { background: [180, 60, 60], color: [255, 255, 255] },
  focus: { background: [72, 76, 92], color: [230, 232, 240] },
  pressed: { background: [220, 90, 90], color: [255, 255, 255] },
};
const CHAT_PILL: Style = {
  padding: [0, 2],
  background: [40, 42, 52],
  color: [212, 214, 224],
  bold: true,
  hover: { background: [86, 90, 108], color: [248, 248, 252] },
  focus: { background: [86, 90, 108], color: [248, 248, 252] },
  pressed: { background: [120, 124, 142], color: [12, 12, 18] },
};

// The hand/board card pinned to the bottom-right (rail-width so it lines up under the
// chat): a "Your hand" title, the hole-card row, and the five board slots. ALWAYS shown
// in poker mode — before a hand is dealt it's all placeholders (?? hole cards, ? board),
// so "your hand" is a permanent fixture rather than appearing only mid-hand.
function handBoardPanel(v: HeroPanelView | null): Node {
  const hand = v?.hand ?? [];
  const board = v?.board ?? [];
  const shown = v?.boardShown ?? 0;
  const handCells = [0, 1].map((i) => cardCell(hand[i]?.seen ? hand[i].card : null, '??'));
  const boardCells = Array.from({ length: 5 }, (_, i) => cardCell(i < shown && i < board.length ? board[i] : null, '?'));
  const title = Text({ text: 'Your hand', style: { color: [222, 224, 234], bold: true } });
  const you = Box({ flexDirection: 'row', gap: 1, alignItems: 'center' }, [rowLabel('You'), ...handCells]);
  const board2 = Box({ flexDirection: 'row', gap: 1, alignItems: 'center' }, [rowLabel('Board'), ...boardCells]);
  return Box({ flexDirection: 'column', gap: 1, width: RAIL_W, padding: [1, 2], background: [22, 24, 32, 0.92] }, [title, you, board2]);
}

const DIVIDER: RGB = [70, 74, 90]; // the rule between the chat panel and the hand panel

// The chat panel: a "Chat" header with a ✕ (collapse) at its far right, over the scrollable
// thread, sized to `height` so it fills the rail above the hand. The header's right padding
// insets the ✕ from the terminal edge to match the chess chat's spacing. `active` suppresses
// the empty placeholder; `onToggle` collapses it to the reopen pill.
function chatPanel(height: number, active: boolean, onToggle: () => void): Node {
  pokerChat.setViewport(Math.max(1, height - 2 * CHAT_PAD_V - CHAT_HEADER_H));
  pokerChat.setActive(active);
  const header = Box({ flexDirection: 'row', justifyContent: 'between', alignItems: 'center', width: RAIL_W - PANEL_PAD_L - PANEL_PAD_R, padding: [0, 2, 0, 0] }, [
    Text({ text: 'Chat', style: { color: [222, 224, 234], bold: true } }),
    Button({ id: 'poker-chat-close', label: '✕', onClick: onToggle, style: CHAT_CLOSE }),
  ]);
  return Box({ flexDirection: 'column', width: RAIL_W, height, padding: [CHAT_PAD_V, PANEL_PAD_R, CHAT_PAD_V, PANEL_PAD_L], background: [22, 24, 32, 0.9] }, [
    header,
    Box({ height: 1 }),
    Slot('poker-chat'),
  ]);
}

// The collapsed chat: a small pill hugging the rail's top-RIGHT corner (right-aligned, with
// the same 2-cell edge inset as the ✕) that reopens the panel.
const chatOpener = (onToggle: () => void): Node =>
  Box({ flexDirection: 'row', justifyContent: 'end', width: RAIL_W, padding: [CHAT_PAD_V, 2, 0, 0] }, [Button({ id: 'poker-chat-open', label: '💬 chat', onClick: onToggle, style: CHAT_PILL })]);

// The right rail: the chat (or, collapsed, its reopen pill) on top, the hand panel ALWAYS
// pinned to the bottom-right. The hand is a permanent fixture; the chat is the collapsible
// one. When expanded, a one-line rule separates the chat from the hand section below.
function buildRightRail(height: number, handBoard: HeroPanelView | null, chatOpen: boolean, active: boolean, onToggleChat: () => void): Node {
  const hand = handBoardPanel(handBoard);
  if (!chatOpen) {
    const top = Box({ flexDirection: 'column', width: RAIL_W, height: Math.max(1, height - HAND_PANEL_H) }, [chatOpener(onToggleChat)]);
    return Box({ flexDirection: 'column', width: RAIL_W, height, flexShrink: 0 }, [top, hand]);
  }
  const topH = Math.max(1, height - HAND_PANEL_H - 1); // -1 for the divider row
  const divider = Box({ width: RAIL_W, height: 1 }, [Text({ text: '─'.repeat(RAIL_W), style: { color: DIVIDER } })]);
  return Box({ flexDirection: 'column', width: RAIL_W, height, flexShrink: 0 }, [chatPanel(topH, active, onToggleChat), divider, hand]);
}

// Build the full-screen poker overlay: a left/main column (info panel top-left, commentary
// toast + betting controls above the bar) beside a full-height right rail (table-talk chat
// on top, the hand/board panel bottom-right). `bar` is buildBar('poker', …) from main.
export function buildPokerGameRoot(
  region: LayoutBox,
  bar: Node,
  opts: {
    hero: HeroContext;
    blinds: string;
    commentary: PokerCommentary | null;
    t: number;
    status: string;
    handBoard: HeroPanelView | null; // the hero's hand/board, or null when no hand is in play
    active: boolean; // a session is running (suppresses the chat's empty placeholder)
    chatOpen: boolean; // table-talk panel expanded vs. collapsed to its reopen pill
    onToggleChat: () => void;
  },
): Node {
  const panel = Box({ flexDirection: 'column', gap: 0, padding: [0, 1], background: [22, 24, 32, 0.9] }, [
    Box({ flexDirection: 'row', justifyContent: 'between', width: LOG_WIDTH }, [
      Text({ text: `Pot ${opts.hero.pot}`, style: { color: [240, 214, 130], bold: true } }),
      Text({ text: `blinds ${opts.blinds}`, style: { color: 'muted' } }),
    ]),
    Slot('poker-log'),
  ]);

  const c = opts.commentary && opts.t < opts.commentary.until ? opts.commentary : null;
  const label = c ? (c.model ? `${shortModel(c.model)}:  ${c.text}` : c.text) : opts.status;
  const toast = label
    ? Box({ padding: [0, 2], background: [22, 24, 32, 0.94] }, [Text({ text: label, style: { color: c ? 'fg' : 'muted' } })])
    : null;

  const controls = opts.hero.toAct ? bettingControls(opts.hero) : null;

  // The main column takes the width left of the rail (flexGrow); the bar lives here, so it
  // spans only the main column — the rail is clear of it, exactly like the chess layout.
  const main = Box({ flexGrow: 1, flexDirection: 'column', height: region.h }, [
    Box({ flexDirection: 'row', justifyContent: 'start', padding: [1, 0, 0, 2] }, [panel]),
    Box({ flexGrow: 1 }),
    ...(toast ? [Box({ flexDirection: 'row', justifyContent: 'start', padding: [0, 0, 1, 2] }, [toast])] : []),
    ...(controls ? [Box({ flexDirection: 'row', justifyContent: 'start', padding: [0, 0, 1, 2] }, [controls])] : []),
    bar,
    Box({ height: 1 }),
  ]);

  // The right rail (chat + hand) only exists once a session is running — before a match
  // starts there's no chat and no hand, so the main column takes the full width.
  const rail = opts.active ? [buildRightRail(region.h, opts.handBoard, opts.chatOpen, opts.active, opts.onToggleChat)] : [];
  return Box({ width: region.w, height: region.h, flexDirection: 'row' }, [main, ...rail]);
}
