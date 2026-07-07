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

export function mountPokerGameHud(ui: Screen): void {
  ui.mount(betSlider);
  ui.mount(actionLog);
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

// ── Top-right hand/board panel ───────────────────────────────────────────────────
// A compact card in the top-right corner showing the hero's two hole cards and the five
// community slots. Hole cards read ?? until the hero peeks them (then rank + suit icon);
// board slots read ? until the flop/turn/river deals them. Collapsible (✕ → a small pill).
const SUIT_ICON = ['♠', '♥', '♦', '♣'] as const; // indexed by Suit (spades, hearts, diamonds, clubs)
const CARD_FACE: RGB = [230, 230, 236]; // light card stock
const CARD_RED: RGB = [196, 30, 40]; // ♥ / ♦
const CARD_BLACK: RGB = [20, 20, 28]; // ♠ / ♣
const CELL_DOWN: RGB = [44, 46, 56]; // face-down / undealt slot
const CELL_DOWN_FG: RGB = [126, 130, 148];
const ROW_LABEL_W = 6; // fixed so the "You"/"Board" rows' cells line up

// One mini-card cell: light stock with rank + suit icon (red for ♥/♦), or a muted slate
// placeholder (`??` for an un-peeked hole card, `?` for an undealt board slot).
function cardCell(card: Card | null, placeholder: string): Node {
  if (!card) return Box({ padding: [0, 1], background: CELL_DOWN }, [Text({ text: placeholder, style: { color: CELL_DOWN_FG, bold: true } })]);
  const label = `${RANK_LABELS[card.rank]}${SUIT_ICON[card.suit]}`;
  return Box({ padding: [0, 1], background: CARD_FACE }, [Text({ text: label, style: { color: isRed(card) ? CARD_RED : CARD_BLACK, bold: true } })]);
}

const HAND_CLOSE: Style = {
  padding: [0, 1],
  color: [150, 154, 166],
  hover: { background: [180, 60, 60], color: [255, 255, 255] },
  focus: { background: [72, 76, 92], color: [230, 232, 240] },
  pressed: { background: [220, 90, 90], color: [255, 255, 255] },
};
const HAND_PILL: Style = {
  padding: [0, 2],
  background: [40, 42, 52],
  color: [212, 214, 224],
  bold: true,
  hover: { background: [86, 90, 108], color: [248, 248, 252] },
  focus: { background: [86, 90, 108], color: [248, 248, 252] },
  pressed: { background: [120, 124, 142], color: [12, 12, 18] },
};

const rowLabel = (t: string): Node => Box({ width: ROW_LABEL_W }, [Text({ text: t, style: { color: 'muted' } })]);

// The expanded panel: "Hand" header (+ ✕), a row for the hero's hole cards, a row for the
// board. `onToggle` collapses it to the opener pill.
function handBoardPanel(v: HeroPanelView, onToggle: () => void): Node {
  const handCells = v.hand.map((h) => cardCell(h.seen ? h.card : null, '??'));
  const boardCells = Array.from({ length: 5 }, (_, i) => cardCell(i < v.boardShown && i < v.board.length ? v.board[i] : null, '?'));
  const title = Text({ text: 'Hand', style: { color: [222, 224, 234], bold: true } });
  const you = Box({ flexDirection: 'row', gap: 1, alignItems: 'center' }, [rowLabel('You'), ...handCells]);
  const board = Box({ flexDirection: 'row', gap: 1, alignItems: 'center' }, [rowLabel('Board'), ...boardCells]);
  // The ✕ sits in the card's top-right CORNER, not beside the title: absolute children
  // resolve inside the [1,2] padding, so top:0 leaves the top padding-row above it and
  // right:-1 pulls it out into the right padding to leave one cell from the edge; the
  // row gap keeps space below. (Same corner-close pattern as the team-switch modal.)
  const close = Box({ position: 'absolute', top: 0, right: -1 }, [Button({ id: 'hand-close', label: '✕', onClick: onToggle, style: HAND_CLOSE })]);
  return Box({ flexDirection: 'column', gap: 1, padding: [1, 2], background: [22, 24, 32, 0.92] }, [title, you, board, close]);
}

// The collapsed state: a small pill in the same corner that re-opens the panel.
const openerPill = (onToggle: () => void): Node => Button({ id: 'hand-open', label: '🂠 hand', onClick: onToggle, style: HAND_PILL });

// Build the full-screen poker overlay: the info panel (pot + action log) pinned
// top-left, the hand/board panel top-right, a commentary toast + the hero betting
// controls above the bar, then the bar. `bar` is buildBar('poker', …) from main.
export function buildPokerGameRoot(
  region: LayoutBox,
  bar: Node,
  opts: {
    hero: HeroContext;
    blinds: string;
    commentary: PokerCommentary | null;
    t: number;
    status: string;
    handBoard: HeroPanelView | null; // null when no hand is in play (panel hidden)
    handOpen: boolean; // expanded vs. collapsed to the opener pill
    onToggleHand: () => void;
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

  const col = Box({ width: region.w, height: region.h, flexDirection: 'column' }, [
    Box({ flexDirection: 'row', justifyContent: 'start', padding: [1, 0, 0, 2] }, [panel]),
    Box({ flexGrow: 1 }),
    ...(toast ? [Box({ flexDirection: 'row', justifyContent: 'start', padding: [0, 0, 1, 2] }, [toast])] : []),
    ...(controls ? [Box({ flexDirection: 'row', justifyContent: 'start', padding: [0, 0, 1, 2] }, [controls])] : []),
    bar,
    Box({ height: 1 }),
  ]);

  // The hand/board panel floats in the top-right corner (over the scene, like the chess
  // chat pill), so it doesn't reflow the columns. Only while a hand is in play.
  if (!opts.handBoard) return col;
  const corner = Box({ position: 'absolute', top: 1, right: 2 }, [
    opts.handOpen ? handBoardPanel(opts.handBoard, opts.onToggleHand) : openerPill(opts.onToggleHand),
  ]);
  return Box({ width: region.w, height: region.h }, [col, corner]);
}
