// The poker game HUD: a WSOP-style broadcast overlay — a gold pot pill top-left, a
// stacked player strip per seat bottom-left ([cards] · name over last action · made
// hand), and a community-board strip bottom-right. On the hero's turn it also shows
// the betting controls in one tight row (Fold / Check|Call, a raise-sizing group — ±
// steppers + a type-in amount + 1/2·3/4·pot chips + Bet/Raise — and All-in). Mirrors the
// chess HUD (games/chess/hud.ts): persistent component instances
// mounted via Slot, rebuilt into a full-screen tree each frame. main owns the scene +
// driver and wires the handlers; this module owns the controls + the table furniture.

import { Box, Button, Input, Modal, type Row, ScrollBox, Slider, Slot, Text, type LayoutBox, type Node, type Screen, type Style } from '../../../tui/index.ts';
import type { RGB } from '../../../engine/index.ts';
import { type Card, isRed, RANK_LABELS } from '../../../rules/poker/cards.ts';
import type { SeatCardView, TableView } from './poker-scene.ts';
import { providerTint } from '../../scenes/wisp.ts';
import { ChatBox, type ChatMessage, CHAT_WIDTH, PANEL_PAD_L, PANEL_PAD_R, wrapText } from '../chess/chat.ts';
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
  currentBet: number; // the bet level to match this street (for pot-fraction sizing)
  bigBlind: number; // one step of the ± steppers; the sizing unit is half of this
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
  onAmountChange(): void; // request a re-render so the amount + button labels follow an edit
}
let H: PokerGameHandlers | null = null;
export function setPokerGameHandlers(h: PokerGameHandlers): void {
  H = h;
}

// A pending voice action awaiting spoken confirmation (heads-up voice mode). When set,
// a callout renders just above the hero's action buttons ("say "yes" to confirm the
// call"). Null clears it. `label` is the action ("fold", "call", "raise to 80", …).
let voiceStage: string | null = null;
export function setPokerVoiceStage(label: string | null): void {
  voiceStage = label;
}

// ── Action-panel geometry (fixed, so button widths NEVER shift with the amount) ──
// The three action buttons have fixed label-field widths — Fold narrowest, Raise widest
// (it holds "Raise to $X" / "All-in"). Labels are space-centred to these, so a button's
// width is constant whether the raise is 2, 3, or 4 digits, or "All-in". Both rows span
// PANEL_W; the sizing row's slider stretches to fill whatever the chips + field leave, so
// the two rows end flush at the same overall width.
const BTN_PAD_H = 2; // ACTION style horizontal padding (each side)
const FOLD_LABEL_W = 10; // Fold is short → narrowest
const CALL_LABEL_W = 14;
const RAISE_LABEL_W = 18; // "Raise to $X" is the longest label → widest
const BTN_GAP = 2; // between the three buttons
const SIZE_GAP = 1; // between sizing-row elements
const CHIP_W = 5; // a 3-char chip ("1/2","2/3","pot","max") + [0,1] padding
const FIELD_W = 6; // the editable $ amount field
const DOLLAR_W = 2; // the "$" label: a leading pad space + the "$", both on the field's pillBg
const PANEL_W = FOLD_LABEL_W + CALL_LABEL_W + RAISE_LABEL_W + 6 * BTN_PAD_H + 2 * BTN_GAP; // total row width
const SLIDER_W = PANEL_W - (4 * CHIP_W + (DOLLAR_W + FIELD_W) + 5 * SIZE_GAP); // fills the sizing row to PANEL_W

// ── Raise sizing: an editable amount field + pot-fraction chips + a fill slider ──
// The raise-TO total lives in a numeric text field (type an exact amount), jumped by the
// pot-fraction / max chips or nudged by the keyboard steppers. The field's string is the
// source of truth so it survives the per-frame rebuild; every legal value is reachable.
// `betInput` only accepts digits; Enter commits the raise.
export const betInput = new Input({
  id: 'poker-bet',
  width: FIELD_W,
  onChange: () => {
    // Keep the buffer numeric; strip anything else the terminal may deliver.
    const digits = betInput.value.replace(/[^0-9]/g, '');
    if (digits !== betInput.value) {
      betInput.value = digits;
      betInput.caret = Math.min(betInput.caret, digits.length);
    }
    H?.onAmountChange();
  },
  onEnter: () => {
    if (lastHero?.canRaise) H?.onBetRaise(betAmount(lastHero));
  },
});
// The hero context from the latest bettingControls build, so the field's Enter and the
// keyboard steppers (nudgePokerBet, driven from main) can size against the live hand.
let lastHero: HeroContext | null = null;
// The decision this field is armed for ("min:max"); when it changes (a new street / turn)
// the field resets to the min-raise so a stale amount never carries over.
let betArmedFor = '';

// A short slider for quick coarse sizing — a companion to the exact field, not the primary
// control (a terminal slider is only ~14 cells, so it ballparks; the field / chips / keys
// land the precise value). Its thumb is driven FROM the amount each frame (see below), and
// dragging it writes a snapped amount back — so field and slider always agree.
export const betSlider = new Slider({
  id: 'poker-bet-slider',
  width: SLIDER_W,
  value: 0.5,
  step: 0.04,
  onChange: () => {
    if (!lastHero || lastHero.maxRaiseTo <= lastHero.minRaiseTo) return;
    setBet(presetRaise(lastHero, lastHero.minRaiseTo + betSlider.value * (lastHero.maxRaiseTo - lastHero.minRaiseTo)));
    H?.onAmountChange();
  },
});

// The chat thread (reuses the chess ChatBox with its own Slot id; same default empty-state
// hint as chess). Each AI's pre-move line is pushed here as in-character table talk that
// never reveals its hole cards.
const pokerChat = new ChatBox('poker-chat');

export function mountPokerGameHud(ui: Screen): void {
  ui.mount(betInput);
  ui.mount(betSlider);
  ui.mount(pokerChat);
  ui.mount(notesScroll);
}

// A model's table-talk line → the thread. clear resets it for a fresh session.
export function pushPokerChat(msg: ChatMessage): void {
  pokerChat.push(msg);
}
export function clearPokerChat(): void {
  pokerChat.clear();
}

// Clamp a raw raise-to into the legal band and round to a whole chip.
function clampRaise(hero: HeroContext, v: number): number {
  return Math.max(hero.minRaiseTo, Math.min(hero.maxRaiseTo, Math.round(v)));
}
// A "clean" preset amount: snap to half a big blind (the small-blind grid) then clamp, so
// the ± steppers and pot-fraction chips land on tidy numbers.
function presetRaise(hero: HeroContext, v: number): number {
  const unit = Math.max(1, Math.round(hero.bigBlind / 2));
  return clampRaise(hero, Math.round(v / unit) * unit);
}
// A pot-fraction raise-TO: match the current bet, then raise BY f × (pot after we call) —
// the standard pot-relative sizing. Clamped + snapped to a tidy amount.
function fractionRaise(hero: HeroContext, f: number): number {
  return presetRaise(hero, hero.currentBet + f * (hero.pot + hero.toCall));
}
// The committed raise-TO total: the field's value, clamped to the legal band (min-raise ..
// all-in). Empty / unparseable → the min-raise.
export function betAmount(hero: HeroContext): number {
  const n = parseInt(betInput.value.replace(/[^0-9]/g, ''), 10);
  return clampRaise(hero, Number.isFinite(n) ? n : hero.minRaiseTo);
}
// Write an amount back into the field (from a stepper / chip / arm), caret at the end.
function setBet(n: number): void {
  betInput.value = String(n);
  betInput.caret = betInput.value.length;
}
// ± stepper by one big blind. Exported so main can bind it to keys (hold to repeat).
export function nudgePokerBet(dirBigBlinds: number): void {
  if (!lastHero?.canRaise) return;
  setBet(presetRaise(lastHero, betAmount(lastHero) + dirBigBlinds * lastHero.bigBlind));
  H?.onAmountChange();
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
// The three big action buttons are 3 rows tall (padding [1,·] → a blank row above and
// below a single centred text row) with no wrapping panel behind them — they float over
// the felt like a WSOP client. Labels are space-centred to a common width so all three are
// equal-width (paint centres text only via symmetric padding, so we pad the string).
const ACTION: Style = { ...BTN, padding: [1, 2] };
const FOLD: Style = { ...ACTION, background: [96, 44, 44], color: [246, 220, 218], hover: { background: [150, 58, 58], color: [255, 240, 238] } };
const RAISE: Style = { ...ACTION, background: [86, 64, 120], color: [238, 230, 250], hover: { background: [110, 84, 150], color: [248, 244, 255] } };
// The sizing row's pot-fraction / max chips (1 row tall, tight padding).
const CHIP: Style = { ...BTN, padding: [0, 1], background: [38, 40, 50], color: [200, 204, 216] };

// Centre a label within `w` cells with spaces so equal-width buttons render centred text.
function centerLabel(s: string, w: number): string {
  if (s.length >= w) return s;
  const left = Math.floor((w - s.length) / 2);
  return ' '.repeat(left) + s + ' '.repeat(w - s.length - left);
}

// The bottom-left corner controls: a green "new match" go button on the idle table,
// which becomes a green "start" + a grey "cancel" while the settings panel is open.
// "start" dims (no onClick) until every shown seat has a committed model.
const MATCH_NEW: Style = {
  padding: [0, 3],
  background: [40, 84, 58],
  color: [226, 240, 230],
  bold: true,
  hover: { background: [54, 108, 74] },
  focus: { background: [54, 108, 74] },
  pressed: { background: [72, 128, 92] },
};
const MATCH_OFF: Style = { padding: [0, 3], background: [34, 36, 44], color: [110, 114, 126], bold: true };
const MATCH_CANCEL: Style = {
  padding: [0, 3],
  background: [44, 46, 56],
  color: [212, 214, 224],
  bold: true,
  hover: { background: [72, 76, 92] },
  focus: { background: [72, 76, 92] },
  pressed: { background: [96, 100, 116] },
};

// The bottom-left corner controls for this frame (null → none, e.g. mid-session).
// `setup` picks the shape: false → a single green "new match"; true → a green "start"
// (dimmed when `onPrimary` is absent) beside a grey "cancel" (→ home). `onPrimary` is
// new-match (idle) / start (setup); `onCancel` is the setup Cancel.
export interface MatchControls {
  setup: boolean;
  onPrimary?: () => void;
  onCancel?: () => void;
}

// The betting controls, shown only on the hero's turn — a WSOP-style two-tier block over
// the felt (no wrapping panel): a thin sizing row (1/2 · 2/3 · pot · max chips + a $ field
// + a short slider) with a one-row gap above three chunky action buttons (Fold · Check|Call
// · Raise). All-in isn't its own button — "max" sizes to the whole stack and the Raise
// button then reads "All-in". Every value is still reachable via the field / chips / keys.
function bettingControls(hero: HeroContext): Node {
  lastHero = hero; // so betInput's Enter + the keyboard steppers size against this hand
  // Re-arm the amount field to the min-raise whenever the decision changes (new street /
  // turn), so a stale amount never carries over. Same decision → leave the user's edit be.
  const key = `${hero.minRaiseTo}:${hero.maxRaiseTo}`;
  const hasRange = hero.canRaise && hero.maxRaiseTo > hero.minRaiseTo;
  if (hero.canRaise && key !== betArmedFor) {
    setBet(hero.minRaiseTo);
    betArmedFor = key;
  }
  // Drive the slider thumb from the current amount so it always agrees with the field.
  if (hasRange) {
    const span = hero.maxRaiseTo - hero.minRaiseTo;
    betSlider.value = Math.max(0, Math.min(1, (betAmount(hero) - hero.minRaiseTo) / span));
  }

  // ── The sizing row (only when there's a real raise range) ──
  const sizingRow: Node[] = [];
  if (hasRange) {
    const chip = (label: string, onClick: () => void): Node => Button({ id: `poker-frac-${label}`, label, onClick, style: CHIP });
    const frac = (label: string, f: number): Node =>
      chip(label, () => {
        setBet(fractionRaise(hero, f));
        H?.onAmountChange();
      });
    sizingRow.push(
      Box({ flexDirection: 'row', gap: SIZE_GAP, alignItems: 'center' }, [
        frac('1/2', 0.5),
        frac('2/3', 2 / 3),
        frac('pot', 1),
        chip('max', () => {
          setBet(hero.maxRaiseTo);
          H?.onAmountChange();
        }),
        // The "$" (white, on the field's pillBg) with a leading pad space, so the amount reads
        // as one box with a little breathing room before the "$". (The extra cell comes out of
        // SLIDER_W, so the row still ends flush with the button row.)
        Box({ flexDirection: 'row', gap: 0, alignItems: 'center' }, [Text({ text: ' $', style: { color: 'fg', bold: true, background: 'pillBg' } }), Slot('poker-bet')]),
        Slot('poker-bet-slider'), // width SLIDER_W → the row ends flush with the button row
      ]),
    );
  }

  // ── The three action buttons: fixed widths (Fold narrow, Raise widest), never resizing ──
  const atMax = hero.canRaise && betAmount(hero) >= hero.maxRaiseTo; // "max" / typed-to-stack → all-in
  const callLabel = hero.toCall > 0 ? (hero.toCall >= hero.stack ? `Call ${money(hero.stack)}` : `Call ${money(hero.toCall)}`) : 'Check';
  const raiseLabel = atMax ? 'All-in' : `${hero.toCall > 0 ? 'Raise to' : 'Bet'} ${money(betAmount(hero))}`;

  const actions: Node[] = [
    Button({ id: 'poker-fold', label: centerLabel('Fold', FOLD_LABEL_W), onClick: () => H?.onFold(), style: FOLD }),
    Button({ id: hero.toCall > 0 ? 'poker-call' : 'poker-check', label: centerLabel(callLabel, CALL_LABEL_W), onClick: () => H?.onCheckCall(), style: ACTION }),
  ];
  if (hero.canRaise) {
    actions.push(
      Button({
        id: 'poker-raise',
        label: centerLabel(raiseLabel, RAISE_LABEL_W),
        onClick: atMax ? () => H?.onAllin() : () => H?.onBetRaise(betAmount(hero)),
        style: RAISE,
      }),
    );
  }

  // A voice-confirm callout sits above everything when an action is staged from speech.
  const voicePrompt: Node[] = voiceStage
    ? [
        Box({ padding: [0, 1], background: [22, 24, 32, 0.94] }, [
          Text({ text: `say "yes" to confirm the ${voiceStage}`, style: { color: [232, 210, 140], bold: true } }),
        ]),
      ]
    : [];

  // Voice prompt (if any), then the sizing row, a one-row gap, then the buttons; left-
  // aligned so the rows start at the same left edge. No panel — it floats over the felt.
  return Box({ flexDirection: 'column', gap: 1, alignItems: 'start' }, [
    ...voicePrompt,
    ...(sizingRow.length ? sizingRow : []),
    Box({ flexDirection: 'row', gap: BTN_GAP }, actions),
  ]);
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
// Chip amounts read as money throughout the HUD: a "$" prefix + thousands separators.
const money = (n: number): string => `$${withCommas(n)}`;

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
// The two top-right pills: a hamburger glyph + "menu", and plain "chat" text (no icon —
// a width-2 speech-bubble glyph left a stray continuation cell past the pill edge).
const MENU_ICON = '☰'; // U+2630 — three stacked lines
const CHAT_PILL: Style = {
  padding: [0, 1],
  background: [40, 42, 52],
  color: [212, 214, 224],
  bold: true,
  hover: { background: [86, 90, 108], color: [248, 248, 252] },
  focus: { background: [86, 90, 108], color: [248, 248, 252] },
  pressed: { background: [120, 124, 142], color: [12, 12, 18] },
};

// ── Notes modal (opponent reads) ─────────────────────────────────────────────────
// A centered modal listing one AI seat's private reads on every other player, paged
// through the seats with ‹ ›. Opened from the top-right "notes" pill; available in both
// the human-plays and all-AI-spectate modes.
const NOTES_NAV: Style = {
  padding: [0, 1],
  background: [40, 42, 52],
  color: [212, 214, 224],
  bold: true,
  hover: { background: [86, 90, 108], color: [248, 248, 252] },
  focus: { background: [86, 90, 108], color: [248, 248, 252] },
  pressed: { background: [120, 124, 142], color: [12, 12, 18] },
};
const NOTES_DIM: Style = { padding: [0, 1], color: [96, 100, 116] }; // disabled ‹ › (single observer)

// Modal geometry. The card is a fixed width so every observer's page is the same size;
// notes word-wrap to fit and the body scrolls at a fixed height (see notesScroll).
const NOTES_INNER_W = 46; // content width inside the card padding (header + scroll region)
const NOTES_WRAP_W = NOTES_INNER_W - 3; // minus the "• " bullet gutter and the scrollbar column
const NOTES_VIEW_H = 16; // fixed viewport height (rows) — generous, always this tall
const NOTES_PLACEHOLDERS = 2; // grey placeholder bullets shown per opponent with no reads yet
const NOTE_HEAD: RGB = [232, 214, 150]; // gold subject name
const NOTE_FG: RGB = [206, 210, 222]; // a read's text
const NOTE_PLACEHOLDER: RGB = [92, 96, 112]; // grey empty-slot bullet

// The scrollable body: a fixed-height viewport over all the entries' rows (rebuilt each
// frame from the current observer's reads). Persistent so its scroll offset survives the
// per-frame rebuild; mounted in mountPokerGameHud, placed via Slot below.
const notesScroll = new ScrollBox({ id: 'poker-notes-scroll', width: NOTES_INNER_W, height: NOTES_VIEW_H, rows: [] });
let notesObserver = ''; // last observer shown, so paging back to the top resets the scroll

// One subject's rows: a gold name line, then each read wrapped to the column as bullets
// (first line "• …", continuations indented). With no reads yet, grey placeholder bullets
// stand in so the block still has shape.
function notesRows(label: string, notes: string[]): Row[] {
  const rows: Row[] = [Text({ text: label, style: { color: NOTE_HEAD, bold: true } })];
  if (notes.length) {
    for (const n of notes) {
      const lines = wrapText(n, NOTES_WRAP_W);
      lines.forEach((line, i) => rows.push(Text({ text: `${i === 0 ? '• ' : '  '}${line}`, style: { color: NOTE_FG } })));
    }
  } else {
    for (let i = 0; i < NOTES_PLACEHOLDERS; i++) rows.push(Text({ text: '•', style: { color: NOTE_PLACEHOLDER } }));
  }
  return rows;
}

// Build the notes modal for the given observer. `entries` are its reads on every other
// seat (label + notes). `canCycle` enables the ‹ › pager (more than one AI seat).
export function buildPokerNotesModal(opts: {
  observerLabel: string;
  entries: { label: string; notes: string[] }[];
  canCycle: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}): Node {
  const prev = opts.canCycle
    ? Button({ id: 'poker-notes-prev', label: '‹', onClick: opts.onPrev, style: NOTES_NAV })
    : Text({ text: '‹', style: NOTES_DIM });
  const next = opts.canCycle
    ? Button({ id: 'poker-notes-next', label: '›', onClick: opts.onNext, style: NOTES_NAV })
    : Text({ text: '›', style: NOTES_DIM });
  const title = Box({ flexDirection: 'row', gap: 1, alignItems: 'center' }, [
    prev,
    Text({ text: `${opts.observerLabel}'s reads`, style: { color: [222, 224, 234], bold: true } }),
    next,
  ]);
  const header = Box({ flexDirection: 'row', justifyContent: 'between', alignItems: 'center', gap: 3, width: NOTES_INNER_W }, [
    title,
    Button({ id: 'poker-notes-close', label: '✕', onClick: opts.onClose, style: CHAT_CLOSE }),
  ]);
  // A blank spacer row between subjects; flatten each subject's rows into one list.
  const rows: Row[] = [];
  opts.entries.forEach((e, i) => {
    if (i > 0) rows.push(Text({ text: '' }));
    rows.push(...notesRows(e.label, e.notes));
  });
  if (opts.observerLabel !== notesObserver) {
    notesScroll.scroll = 0; // paged to a different observer — start at the top
    notesObserver = opts.observerLabel;
  }
  notesScroll.rows = rows;
  const card = Box({ flexDirection: 'column', alignItems: 'stretch', gap: 1, padding: [1, 3], background: [22, 24, 32] }, [
    header,
    Slot('poker-notes-scroll'),
  ]);
  return Modal(card);
}

// ── Pot pill (top-left) ────────────────────────────────────────────────────────────
const POT_BG: RGB = [150, 116, 40]; // WSOP gold
const POT_FG: RGB = [24, 18, 6]; // dark ink on the gold pill
// The gold pot pill: a spade emblem + "POT  1,240", with the blinds as a muted line
// beneath. `alignItems: 'stretch'` makes both rows take the column's width (the wider of
// the two), so the gold bar and the blinds line always share an edge — a small pot no
// longer leaves the gold bar narrower than the blinds beneath it.
function potPill(pot: number, blinds: string): Node {
  return Box({ flexDirection: 'column', gap: 0, alignItems: 'stretch' }, [
    Box({ padding: [0, 2], background: POT_BG }, [Text({ text: `♠ POT  ${money(pot)}`, style: { color: POT_FG, bold: true } })]),
    Box({ padding: [0, 1] }, [Text({ text: `blinds ${blinds.split('/').map((b) => `$${b}`).join('/')}`, style: { color: 'muted' } })]),
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
    Text({ text: money(s.stack), style: { color: win ? WIN_INK : s.folded ? DIM_FG : CHIP_FG, bold: true } }),
  ]);
  // Top-right badge: "eliminated" (greyed) for a busted seat sitting out, else its
  // blind/button position for the hand.
  const badge = s.eliminated
    ? Text({ text: 'eliminated', style: { color: DIM_FG, bold: true } })
    : Text({ text: s.pos, style: { color: win ? WIN_INK : 'muted', bold: true } });
  const header = Box({ flexDirection: 'row', justifyContent: 'between', alignItems: 'center', width: STRIP_W }, [left, badge]);

  const cells = [0, 1].map((i) => cardCell(s.cards[i] ?? null, '??'));
  // A single info field: the action while the hand plays, the made-hand once it ends.
  const text = ended ? s.madeHand : s.allIn ? 'ALL IN' : (s.lastAction ?? '');
  const color = win ? WIN_INK : ended ? (s.folded ? DIM_FG : MADE_FG) : s.folded ? DIM_FG : ACTION_FG;
  const info = text ? [Text({ text, style: { color, bold: win } })] : [];
  // Fixed width (matching the header), so every strip is the same width and the right
  // edges line up flush — a content-sized row makes longer actions jut out (jagged).
  const cardRow = Box({ flexDirection: 'row', gap: 1, alignItems: 'center', width: STRIP_W }, [...cells, ...info]);

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
// Styled exactly like a player strip so it reads as one of the stack: two rows, the same
// STRIP_W width. Top row: the "Board" label top-left with the street (Pre-flop / Flop /
// Turn / River) pinned top-right, mirroring a seat's name + position badge. Bottom row:
// the five community slots, mirroring a seat's two hole cards. Undealt slots read a muted
// "??" (matching hidden hole cards, two chars so the grid never reflows) and are replaced in place as streets deal.
const STREET_LABEL: Record<string, string> = { preflop: 'Pre-flop', flop: 'Flop', turn: 'Turn', river: 'River', showdown: 'Showdown' };
function boardPanel(v: TableView | null): Node {
  const board = v?.board ?? [];
  const shown = v?.boardShown ?? 0;
  const street = v ? (STREET_LABEL[v.street] ?? v.street) : '';
  const header = Box({ flexDirection: 'row', justifyContent: 'between', alignItems: 'center', width: STRIP_W }, [
    Text({ text: 'Board', style: { color: [222, 224, 234], bold: true } }),
    Text({ text: street, style: { color: 'muted', bold: true } }),
  ]);
  const cells = Array.from({ length: 5 }, (_, i) => cardCell(i < shown && i < board.length ? board[i] : null, '??'));
  const cardRow = Box({ flexDirection: 'row', gap: 1, alignItems: 'center', width: STRIP_W }, cells);
  return Box({ flexDirection: 'column', gap: 0, padding: [0, 1], background: [22, 24, 32, 0.92] }, [header, cardRow]);
}

// ── Top-centre banners (community deal + end-of-hand winner) ─────────────────────
// While the flop/turn/river deals under the fixed bird's-eye, this floats at the top,
// centred, over the bare scene (no panel background): a "Board" label + a mini-card per
// community card on the felt so far (synced to the 3D deal — a cell appears as each card
// lands, so the flop grows the row and the turn/river add to the already-shown ones).
// Board-strip card style; the card cells keep their own light stock.
function cineBanner(label: string, cards: Card[]): Node {
  return Box({ flexDirection: 'row', gap: 1, alignItems: 'center' }, [
    Text({ text: label, style: { color: [222, 224, 234], bold: true } }),
    ...cards.map((c) => cardCell(c, '??')),
  ]);
}

// The end-of-hand winner line ("Claude wins $240" / "You win $240"), gold to match the
// pot / winning-strip theme. Sits in the same top-centre slot as the cine banner.
const WIN_TEXT: RGB = [232, 214, 150];
function resultBanner(text: string): Node {
  return Text({ text, style: { color: WIN_TEXT, bold: true } });
}

// The "press any key to continue" prompt shown one row under whichever banner is up. Only
// a keypress advances — the mouse stays free to orbit/zoom the scene while it's showing.
const CONTINUE_TEXT = 'press any key to continue';

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

// The right rail: the table-talk chat, full height, pinned to the right edge. Present only
// when the chat is OPEN — collapsed, the rail reserves no width (so the bottom-right controls
// can reach the true corner) and its reopen pill lives in the top-right of the main area.
function buildRightRail(height: number, active: boolean, onToggleChat: () => void): Node {
  return Box({ flexDirection: 'column', width: RAIL_W, height, flexShrink: 0 }, [chatPanel(height, active, onToggleChat)]);
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
    onOpenMenu: () => void; // ☰ pill → the in-game menu popup (home / restart / mode / quit)
    onOpenNotes: () => void; // "notes" pill → the opponent-notes modal
    setup: Node | null; // the new-match settings panel (top-left, in place of the pot pill)
    matchControls: MatchControls | null; // the bottom-left new-match / start+cancel controls
    hideHud: boolean; // during a community-deal cinematic: hide all but the top-right pills + rail
    cineLabel: { label: string; cards: Card[] } | null; // top-centre "Board" + cards during that cinematic
    resultLabel: string | null; // top-centre end-of-hand winner line (over the visible table)
    awaitingContinue: boolean; // show the "click anywhere to continue" prompt under the banner
  },
): Node {
  // During a community-deal cinematic everything but the top-right pills + rail is hidden,
  // so the bird's-eye of the dealing board reads clean (see PokerGameScene.cineHideHud).
  const hide = opts.hideHud;
  const pot = !hide && opts.table ? potPill(opts.table.pot, opts.blinds) : null;
  const board = !hide && opts.table ? boardPanel(opts.table) : null;
  const strips = !hide && opts.table && opts.table.seats.length ? playerStrips(opts.table.seats, opts.table.ended) : null;

  const c = opts.commentary && opts.t < opts.commentary.until ? opts.commentary : null;
  const label = c ? (c.model ? `${shortModel(c.model)}:  ${c.text}` : c.text) : opts.status;
  const toast =
    !hide && label
      ? Box({ padding: [0, 2], background: [22, 24, 32, 0.94] }, [Text({ text: label, style: { color: c ? 'fg' : 'muted' } })])
      : null;

  const controls = !hide && opts.hero.toAct ? bettingControls(opts.hero) : null;

  // The rail (full-height chat) only reserves width when the chat is OPEN. Collapsed, main
  // takes the whole width so the bottom-right controls reach the true corner. `mainW` is the
  // width the top/bottom bands span (so their flexGrow spacers have slack to distribute).
  const railOpen = opts.active && opts.chatOpen;
  const mainW = region.w - (railOpen ? RAIL_W : 0);

  // Top band: pot pill top-LEFT; a right cluster top-RIGHT holding the ☰ menu pill and,
  // when the chat is collapsed, the chat pill to its right (menu left, chat right). When
  // the chat is OPEN the rail is a separate column and this band spans only `mainW`, so the
  // menu pill lands flush against the left edge of the chat panel — exactly where we want
  // it. The chat pill's ✕ (in the open panel's header) handles collapse, so it drops here.
  const menuPill = Button({ id: 'poker-menu', label: `${MENU_ICON} menu`, onClick: opts.onOpenMenu, style: CHAT_PILL });
  // The notes pill sits between menu and chat, shown whenever a session is live (both when
  // the human plays and when spectating an all-AI table).
  const notesPill = opts.active ? Button({ id: 'poker-notes', label: 'reads', onClick: opts.onOpenNotes, style: CHAT_PILL }) : null;
  const chatPill =
    opts.active && !opts.chatOpen ? Button({ id: 'poker-chat-open', label: 'chat', onClick: opts.onToggleChat, style: CHAT_PILL }) : null;
  const rightCluster = Box({ flexDirection: 'row', gap: 1, alignItems: 'center' }, [menuPill, ...(notesPill ? [notesPill] : []), ...(chatPill ? [chatPill] : [])]);
  // The top-left slot holds the pot pill in a session, or the new-match settings panel
  // while it's open (they never coexist — the panel only shows on the idle table).
  const topLeft = hide ? [] : opts.setup ? [opts.setup] : pot ? [pot] : [];
  const topBand = Box({ flexDirection: 'row', alignItems: 'start', width: mainW, padding: [1, 2, 0, 2] }, [
    ...topLeft,
    Box({ flexGrow: 1 }),
    rightCluster,
  ]);

  // The bottom-left corner controls. Idle: a single green "new match". Setup panel open:
  // a green "start" (dimmed until every seat has a model) beside a grey "cancel" (→ home).
  const mc = hide ? null : opts.matchControls;
  const matchBtn = !mc
    ? []
    : !mc.setup
      ? [Button({ id: 'poker-match', label: 'new match', onClick: mc.onPrimary, style: MATCH_NEW })]
      : [
          Box({ flexDirection: 'row', gap: 2 }, [
            Button({ id: 'poker-start', label: 'start', onClick: mc.onPrimary, style: mc.onPrimary ? MATCH_NEW : MATCH_OFF }),
            Button({ id: 'poker-cancel', label: 'cancel', onClick: mc.onCancel, style: MATCH_CANCEL }),
          ]),
        ];

  // Bottom band: the status/commentary toast, the board, and the player strips stack up
  // bottom-LEFT (the match button at the very bottom of that stack); the betting controls
  // sit in the bottom-RIGHT corner with a small margin (not tucked flush). alignItems:'end'
  // bottom-aligns the two clusters.
  const leftCluster = Box({ flexDirection: 'column', gap: 1, alignItems: 'start' }, [
    ...(toast ? [toast] : []),
    ...(board ? [board] : []),
    ...(strips ? [strips] : []),
    ...matchBtn,
  ]);
  // The band sits one row off the bottom (a trailing spacer in `main`). When the
  // new-match / start+cancel button is showing, drop the band's own bottom padding so it
  // sits a single row off the edge — a bottom margin that reads level with the 2-cell left
  // inset (a terminal row is taller than a column is wide). In-session (strips, no button)
  // keeps the roomier 2-row bottom margin.
  const bandPadBottom = matchBtn.length ? 0 : 1;
  const bottomBand = Box({ flexDirection: 'row', alignItems: 'end', width: mainW, padding: [0, 0, bandPadBottom, 2] }, [
    leftCluster,
    Box({ flexGrow: 1 }),
    ...(controls ? [Box({ padding: [0, 2, 0, 0] }, [controls])] : []),
  ]);

  // The top-centre banner floats over the main column (an absolute row so it doesn't disturb
  // the top-right pills): the community-deal street+cards while the cinematic hides the HUD,
  // or the end-of-hand winner line over the still-visible table. A "click anywhere to
  // continue" prompt sits one row beneath it while the scene is awaiting the gesture.
  const bannerBody = hide && opts.cineLabel ? cineBanner(opts.cineLabel.label, opts.cineLabel.cards) : opts.resultLabel ? resultBanner(opts.resultLabel) : null;
  const banner = bannerBody
    ? Box({ position: 'absolute', top: 1, left: 0, width: mainW }, [
        Box({ flexDirection: 'column', alignItems: 'center', gap: 0, width: mainW }, [
          bannerBody,
          ...(opts.awaitingContinue ? [Text({ text: CONTINUE_TEXT, style: { color: 'muted' } })] : []),
        ]),
      ])
    : null;

  // The main column takes the width left of the rail (flexGrow); the bar lives here, so it
  // spans only the main column — the rail is clear of it, exactly like the chess layout.
  const main = Box({ flexGrow: 1, flexDirection: 'column', height: region.h }, [
    topBand,
    Box({ flexGrow: 1 }),
    bottomBand,
    bar,
    Box({ height: 1 }),
    ...(banner ? [banner] : []),
  ]);

  const rail = railOpen ? [buildRightRail(region.h, opts.active, opts.onToggleChat)] : [];
  return Box({ width: region.w, height: region.h, flexDirection: 'row' }, [main, ...rail]);
}
