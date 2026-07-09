// The poker game HUD: a WSOP-style broadcast overlay — a gold pot pill top-left, a
// stacked player strip per seat bottom-left ([cards] · name over last action · made
// hand), and a community-board strip bottom-right. On the hero's turn it also shows
// the betting controls (Fold / Check|Call, a raise-amount Slider with Bet/Raise +
// All-in). Mirrors the chess HUD (games/chess/hud.ts): persistent component instances
// mounted via Slot, rebuilt into a full-screen tree each frame. main owns the scene +
// driver and wires the handlers; this module owns the controls + the table furniture.

import { Box, Button, Slider, Slot, Text, type LayoutBox, type Node, type Screen, type Style } from '../../../tui/index.ts';
import type { RGB } from '../../../engine/index.ts';
import { type Card, isRed, RANK_LABELS } from '../../../rules/poker/cards.ts';
import type { SeatCardView, TableView } from './poker-scene.ts';
import { providerTint } from '../../scenes/wisp.ts';
import { ChatBox, type ChatMessage, CHAT_WIDTH, PANEL_PAD_L, PANEL_PAD_R } from '../chess/chat.ts';
import { shortModel } from '../chess/hud.ts';

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
// The chat thread (reuses the chess ChatBox with its own Slot id; same default empty-state
// hint as chess). Each AI's pre-move line is pushed here as in-character table talk that
// never reveals its hole cards.
const pokerChat = new ChatBox('poker-chat');

export function mountPokerGameHud(ui: Screen): void {
  ui.mount(betSlider);
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

// ── Right rail: table-talk chat ─────────────────────────────────────────────────
// A full-height column pinned to the right edge (like the chess chat rail), holding the
// table-talk thread (or, collapsed, its reopen pill). The board used to live at its
// bottom; it now sits bottom-left above the player strips, so the rail is chat-only.
const RAIL_W = CHAT_WIDTH; // rail width = chat width
const CHAT_PAD_V = 1; // chat panel top/bottom inset
const CHAT_HEADER_H = 2; // header row + a gap row

const SUIT_ICON = ['♠', '♥', '♦', '♣'] as const; // indexed by Suit (spades, hearts, diamonds, clubs)
const CARD_FACE: RGB = [230, 230, 236]; // light card stock
const CARD_RED: RGB = [196, 30, 40]; // ♥ / ♦
const CARD_BLACK: RGB = [20, 20, 28]; // ♠ / ♣
const CELL_DOWN: RGB = [44, 46, 56]; // face-down / undealt slot
const CELL_DOWN_FG: RGB = [126, 130, 148];

// Thousands separators for chip amounts (POT 1,240) — a tiny formatter, locale-free.
const withCommas = (n: number): string => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// One mini-card cell: light stock with rank + suit icon (red for ♥/♦), or a muted slate
// placeholder (`??` for a hidden hole card, `♠` for an undealt board slot). Ten is
// rendered "T" (poker shorthand) so every card is exactly two chars → a tidy fixed grid.
function cardCell(card: Card | null, placeholder: string): Node {
  if (!card) return Box({ padding: [0, 1], background: CELL_DOWN }, [Text({ text: placeholder, style: { color: CELL_DOWN_FG, bold: true } })]);
  const rank = RANK_LABELS[card.rank] === '10' ? 'T' : RANK_LABELS[card.rank];
  return Box({ padding: [0, 1], background: CARD_FACE }, [Text({ text: `${rank}${SUIT_ICON[card.suit]}`, style: { color: isRed(card) ? CARD_RED : CARD_BLACK, bold: true } })]);
}

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

// ── Pot pill (top-left) ────────────────────────────────────────────────────────────
const POT_BG: RGB = [150, 116, 40]; // WSOP gold
const POT_FG: RGB = [24, 18, 6]; // dark ink on the gold pill
// The gold pot pill: a spade emblem + "POT  1,240", with the blinds as a muted line
// beneath. Mirrors the reference's top-left pot readout.
function potPill(pot: number, blinds: string): Node {
  return Box({ flexDirection: 'column', gap: 0 }, [
    Box({ padding: [0, 2], background: POT_BG }, [Text({ text: `♠ POT  ${withCommas(pot)}`, style: { color: POT_FG, bold: true } })]),
    Box({ padding: [0, 1] }, [Text({ text: `blinds ${blinds}`, style: { color: 'muted' } })]),
  ]);
}

// ── Player strips (bottom-left) ──────────────────────────────────────────────────
const STRIP_W = 30; // strip content width, so the SB/BB position badge pins to the right
const NAME_DEFAULT: RGB = [224, 226, 236];
const CHIP_FG: RGB = [236, 238, 246]; // chip count
const ACTION_FG: RGB = [232, 214, 150]; // warm "last action" text
const MADE_FG: RGB = [176, 182, 200]; // the made-hand shown at the end
const DIM_FG: RGB = [116, 120, 136]; // folded seats
// The winner's strip goes gold (matching the pot pill) with dark ink, so at the end of a
// hand the eye lands on who won while the revealed state lingers before the reshuffle.
const WIN_BG: RGB = [150, 116, 40];
const WIN_INK: RGB = [26, 20, 6];

function seatTint(provider?: string): RGB {
  if (!provider) return NAME_DEFAULT;
  const t = providerTint(provider);
  return [t.x | 0, t.y | 0, t.z | 0];
}

// One player strip, two rows. Top: name (far left) with the chip count directly to its
// right, and the blind/button position (SB / BB / BTN) pinned to the far right. Bottom:
// the two hole cards (hidden → ??) with a single info field to their right — the last
// action DURING play, switching to the made-hand once the hand is over (comparing who
// won). The seat to act gets a lit background; folded seats dim.
function playerStrip(s: SeatCardView, ended: boolean): Node {
  const win = ended && s.award > 0; // the hand is over and this seat took (a share of) the pot
  const left = Box({ flexDirection: 'row', gap: 1, alignItems: 'center' }, [
    Text({ text: s.name, style: { color: win ? WIN_INK : s.folded ? DIM_FG : seatTint(s.provider), bold: true } }),
    Text({ text: withCommas(s.stack), style: { color: win ? WIN_INK : s.folded ? DIM_FG : CHIP_FG, bold: true } }),
  ]);
  const badge = Text({ text: s.pos, style: { color: win ? WIN_INK : 'muted', bold: true } });
  const header = Box({ flexDirection: 'row', justifyContent: 'between', alignItems: 'center', width: STRIP_W }, [left, badge]);

  const cells = [0, 1].map((i) => cardCell(s.cards[i] ?? null, '??'));
  // A single info field: the action while the hand plays, the made-hand once it ends.
  const text = ended ? s.madeHand : s.allIn ? 'ALL IN' : (s.lastAction ?? '');
  const color = win ? WIN_INK : ended ? (s.folded ? DIM_FG : MADE_FG) : s.folded ? DIM_FG : ACTION_FG;
  const info = text ? [Text({ text, style: { color, bold: win } })] : [];
  const cardRow = Box({ flexDirection: 'row', gap: 1, alignItems: 'center' }, [...cells, ...info]);

  // Winner → gold; the seat to act → lit; everyone else → the base slate.
  const bg: [number, number, number, number] = win ? [...WIN_BG, 1] : s.toAct ? [46, 52, 72, 0.96] : [22, 24, 32, 0.9];
  return Box({ flexDirection: 'column', gap: 0, padding: [0, 1], background: bg }, [header, cardRow]);
}

// The stacked strips, one per seat (seat order, top to bottom). `ended` swaps the info
// field from live actions to made-hands.
function playerStrips(seats: readonly SeatCardView[], ended: boolean): Node {
  return Box({ flexDirection: 'column', gap: 1 }, seats.map((s) => playerStrip(s, ended)));
}

// ── Board panel (bottom-left, above the player strips) ───────────────────────────
// The five community cards, the exact same width as a player strip so it stacks flush
// above them. Three rows tall: a blank row, a content row (the "Board" label with the
// five card slots to its right), then a blank row — the content vertically centred.
// Undealt slots read a muted "··" and are replaced in place by the flop / turn / river,
// so every cell stays the same width (a tidy, non-reflowing grid).
function boardPanel(v: TableView | null): Node {
  const board = v?.board ?? [];
  const shown = v?.boardShown ?? 0;
  const cells = Array.from({ length: 5 }, (_, i) => cardCell(i < shown && i < board.length ? board[i] : null, '··'));
  const middle = Box({ flexDirection: 'row', gap: 1, alignItems: 'center', width: STRIP_W }, [
    Text({ text: 'Board', style: { color: [222, 224, 234], bold: true } }),
    ...cells,
  ]);
  return Box({ flexDirection: 'column', justifyContent: 'center', width: STRIP_W, height: 3, padding: [0, 1], background: [22, 24, 32, 0.92] }, [middle]);
}

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

// The right rail: the chat fills the full height (or, collapsed, its reopen pill hugs the
// top-right corner). The board no longer lives here — it moved bottom-left above the strips.
function buildRightRail(height: number, chatOpen: boolean, active: boolean, onToggleChat: () => void): Node {
  const body = chatOpen ? chatPanel(height, active, onToggleChat) : chatOpener(onToggleChat);
  return Box({ flexDirection: 'column', width: RAIL_W, height, flexShrink: 0 }, [body]);
}

// Build the full-screen poker overlay, WSOP-style: the pot pill top-left and the stacked
// player strips bottom-left (with the commentary toast + betting controls above the bar),
// beside a full-height right rail (table-talk chat on top, the community board bottom-
// right). `bar` is buildBar('poker', …) from main.
export function buildPokerGameRoot(
  region: LayoutBox,
  bar: Node,
  opts: {
    hero: HeroContext;
    blinds: string;
    commentary: PokerCommentary | null;
    t: number;
    status: string;
    table: TableView | null; // every seat's row + pot/board, or null when no session is running
    active: boolean; // a session is running (suppresses the chat's empty placeholder)
    chatOpen: boolean; // table-talk panel expanded vs. collapsed to its reopen pill
    onToggleChat: () => void;
  },
): Node {
  const pot = opts.table ? potPill(opts.table.pot, opts.blinds) : null;
  const board = opts.table ? boardPanel(opts.table) : null;
  const strips = opts.table && opts.table.seats.length ? playerStrips(opts.table.seats, opts.table.ended) : null;

  const c = opts.commentary && opts.t < opts.commentary.until ? opts.commentary : null;
  const label = c ? (c.model ? `${shortModel(c.model)}:  ${c.text}` : c.text) : opts.status;
  const toast = label
    ? Box({ padding: [0, 2], background: [22, 24, 32, 0.94] }, [Text({ text: label, style: { color: c ? 'fg' : 'muted' } })])
    : null;

  const controls = opts.hero.toAct ? bettingControls(opts.hero) : null;

  // The bottom band spans the main column: the status/commentary toast, the board, and the
  // player strips stack up bottom-LEFT; the betting controls sit bottom-RIGHT with a margin
  // from the rail (not tucked flush against it). alignItems:'end' bottom-aligns the two.
  const leftCluster = Box({ flexDirection: 'column', gap: 1, alignItems: 'start' }, [
    ...(toast ? [toast] : []),
    ...(board ? [board] : []),
    ...(strips ? [strips] : []),
  ]);
  // Width the band to the main column (full width minus the rail) so the flexGrow spacer
  // actually has slack to distribute — rows here are otherwise content-sized.
  const mainW = region.w - (opts.active ? RAIL_W : 0);
  const bottomBand = Box({ flexDirection: 'row', alignItems: 'end', width: mainW, padding: [0, 0, 1, 2] }, [
    leftCluster,
    Box({ flexGrow: 1 }),
    ...(controls ? [Box({ padding: [0, 4, 0, 0] }, [controls])] : []),
  ]);

  // The main column takes the width left of the rail (flexGrow); the bar lives here, so it
  // spans only the main column — the rail is clear of it, exactly like the chess layout.
  // Pot pill pinned top-left; the bottom band rides just above the bar.
  const main = Box({ flexGrow: 1, flexDirection: 'column', height: region.h }, [
    ...(pot ? [Box({ flexDirection: 'row', justifyContent: 'start', padding: [1, 0, 0, 2] }, [pot])] : []),
    Box({ flexGrow: 1 }),
    bottomBand,
    bar,
    Box({ height: 1 }),
  ]);

  // The right rail (chat) only exists once a session is running — before a match starts
  // there's no chat, so the main column takes the full width.
  const rail = opts.active ? [buildRightRail(region.h, opts.chatOpen, opts.active, opts.onToggleChat)] : [];
  return Box({ width: region.w, height: region.h, flexDirection: 'row' }, [main, ...rail]);
}
