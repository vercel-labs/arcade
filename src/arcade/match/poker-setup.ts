// The poker match setup: an in-scene settings panel stacked down the top-left of the
// table view (no modal, no scrim — the felt stays interactive behind it). Choose the
// mode (you play vs. spectate), the player count (2..6 seats, you included), and a
// creator → model per AI seat. Every choice is pre-committed to a sensible default so
// the bottom-left "start match" button is live immediately. State lives on module-level
// instances so it survives the per-frame rebuild (mounted via Slot). The table behind
// previews the choices live — chairs follow the player count and each AI seat's wisp
// follows its creator — via the onChanged hook (main wires it to scene.setPreview).

import { Box, Dropdown, Field, Slider, Slot, Text, type Node, type Screen } from '../../tui/index.ts';
import type { RGB } from '../../engine/index.ts';
import { pickerCreators } from './models.ts';
import { shortModel } from '../../harness/model-label.ts';
import { BIG_BLIND, type PokerSeatSpec } from './poker-driver.ts';
import type { PokerSeatView } from '../games/poker/poker-scene.ts';
import { ARCADE_CHROME_TEXT } from '../theme.ts';
import { createModelSeatPicker, hiddenModelSeat, modelSeatControls, modelSeatTint, mountModelSeat, setModelSeatCreators, type ModelCreator, type ModelSeatPicker } from './model-seat-picker.ts';
import { resolveDefaultCreators } from './default-seats.ts';
import { matchSetupHeading } from './match-setup-chrome.ts';

let TEXT_CREATORS: ModelCreator[] = pickerCreators();
const CREATOR_W = 22;
const MODEL_W = 22;
const MAX_OPP = 5; // up to a 6-seat table (you + 5)
const SEAT_LABEL_W = 10;

// Fires on every committed change (mode / players / creator / model), so main can
// refresh the live table preview. Null until main wires it (module init picks the
// defaults before the hook exists — nothing to preview yet).
let onChanged: (() => void) | null = null;
export function setPokerSetupChanged(fn: () => void): void {
  onChanged = fn;
}
const changed = (): void => {
  onChanged?.();
};

// Per-seat configs. Each opens on a creator from the default cycle (OpenAI, Anthropic,
// Google, xAI, then around again) with the model left to pick, so every chair shows its
// wisp and "start match" waits until each shown seat has a model. Index 0 is seat 1's
// config, used only in SPECTATE mode (where seat 1 is an AI too); in HERO mode you play
// seat 1 and indices 1..MAX_OPP are your opponents (seats 2..6).
const SEATS = 6;
const sides: ModelSeatPicker[] = resolveDefaultCreators(TEXT_CREATORS, SEATS).map((creator, i) =>
  createModelSeatPicker({ idPrefix: `poker-opp${i}`, creators: TEXT_CREATORS, defaultCreator: creator ?? 'openai', onChange: changed }),
);
export function setPokerSetupModelCatalog(textCreators: readonly ModelCreator[]): void {
  TEXT_CREATORS = [...textCreators];
  const defaults = resolveDefaultCreators(TEXT_CREATORS, SEATS);
  sides.forEach((side, i) => setModelSeatCreators(side, TEXT_CREATORS, defaults[i]));
  changed();
}

// How many players sit at the table (you included in HERO mode): 2..6. Defaults to a
// 4-handed table. Index i → i+2 players → i+1 AI opponent configs. Exported (like the
// mode picker) so the snapshot tool can drive variants headlessly.
export const playersDropdown = new Dropdown({
  id: 'poker-players',
  items: Array.from({ length: MAX_OPP }, (_, i) => String(i + 2)),
  width: 6,
  index: 2, // default: 4 players
  onSelect: () => changed(),
});
function oppCount(): number {
  return (playersDropdown.index < 0 ? 2 : playersDropdown.index) + 1;
}

// Configurable starting stack (per player, for the whole session). A slider from 1000 to
// 10000 chips, snapped to a whole big blind so the amount always divides cleanly into bets
// and never reads as an odd number. Defaults to the classic 1000. Shown below Players; the
// "$" readout + slider together span a seat row's provider+model width, so the panel stays
// a single tidy column and never grows past the seat rows.
const STACK_MIN = 1000;
const STACK_MAX = 10000;
const STACK_READOUT_W = 7; // fits "$10,000"
const STACK_SLIDER_W = CREATOR_W + 1 + MODEL_W - STACK_READOUT_W - 1; // == a seat's control columns
const money = (n: number): string => `$${n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
const clampStack = (n: number): number => Math.max(STACK_MIN, Math.min(STACK_MAX, n));
const snapStack = (n: number): number => clampStack(Math.round(n / BIG_BLIND) * BIG_BLIND);
const stackToNorm = (chips: number): number => (chips - STACK_MIN) / (STACK_MAX - STACK_MIN);
const normToStack = (v: number): number => snapStack(STACK_MIN + v * (STACK_MAX - STACK_MIN));

let startingStack = STACK_MIN;

// The stack slider: drag (or ←/→, ~5 blinds a nudge) picks the amount; onChange snaps it to
// a whole big blind and re-homes the thumb there, so the value can never rest on an odd
// number. Exported like the other setup controls so the snapshot tool can drive it.
export const stackSlider = new Slider({
  id: 'poker-stack',
  width: STACK_SLIDER_W,
  value: stackToNorm(startingStack),
  step: (BIG_BLIND * 5) / (STACK_MAX - STACK_MIN),
  onChange: (v) => {
    const chips = normToStack(v);
    stackSlider.value = stackToNorm(chips); // snap the thumb onto the whole-blind value
    if (chips === startingStack) return;
    startingStack = chips;
    changed();
  },
});

// The chosen per-player starting chips (a whole multiple of the big blind). Read by main
// when it starts the session.
export function pokerStartingStack(): number {
  return startingStack;
}

// Hero (you play seat 1) vs. Spectate (all AI — seat 1 is a model too, and every hand
// is visible). Drives whether seat 1 gets its own model row.
export const modeDropdown = new Dropdown({
  id: 'poker-setup-mode',
  items: ['play vs ai', 'spectate ai'],
  width: 16,
  index: 0,
  onSelect: () => changed(),
});
function spectating(): boolean {
  return modeDropdown.index === 1;
}

export function pokerSeatPicker(index: number): ModelSeatPicker {
  return sideForIndex(index);
}

function sideForIndex(index: number): ModelSeatPicker {
  return sides[index];
}

// The AI-config indices shown as rows: opponents 1..oppCount always, plus seat 1's
// config (index 0) when spectating.
function shownIndices(): number[] {
  const idx: number[] = [];
  if (spectating()) idx.push(0);
  for (let i = 1; i <= oppCount(); i++) idx.push(i);
  return idx;
}

export function mountPokerSetup(ui: Screen): void {
  ui.mount(playersDropdown);
  ui.mount(modeDropdown);
  ui.mount(stackSlider);
  for (const side of sides) mountModelSeat(ui, side);
}

// Ready when every shown seat's config has a committed model.
export function pokerSetupReady(): boolean {
  return shownIndices().every((i) => sideForIndex(i).modelId !== null);
}

// The chosen seats. HERO: seat 1 is the human, seats 2..N are the shown opponents.
// SPECTATE: every seat is an AI (seat 1 uses index 0's config). null if any shown
// config lacks a model.
export function pokerSetupSelection(): PokerSeatSpec[] | null {
  if (!pokerSetupReady()) return null;
  const seats: PokerSeatSpec[] = [
    spectating() ? { kind: 'ai', model: sides[0].modelId!, runtime: 'text' } : { kind: 'human' },
  ];
  for (let i = 1; i <= oppCount(); i++) {
    const side = sideForIndex(i);
    seats.push({ kind: 'ai', model: side.modelId!, runtime: 'text' });
  }
  return seats;
}

// The current choices as scene seat views, for the live idle-table preview: the chair
// ring follows the count and each AI seat's wisp follows its creator. A seat whose
// model is un-committed (creator re-picked, model pending) still previews by creator.
export function pokerPreviewSeats(): PokerSeatView[] {
  const ai = (side: ModelSeatPicker): PokerSeatView => ({
    kind: 'ai',
    label: side.modelId ? shortModel(side.modelId) : side.creator ?? 'AI',
    creator: side.creator ?? undefined,
  });
  const seats: PokerSeatView[] = [spectating() ? ai(sides[0]) : { kind: 'human', label: 'you' }];
  for (let i = 1; i <= oppCount(); i++) seats.push(ai(sideForIndex(i)));
  return seats;
}

const HERO_FG: RGB = ARCADE_CHROME_TEXT.body;
// A settings line: a muted label gutter + the control, so the columns align.
function row(label: string, control: Node): Node {
  return Field({ label, child: control, direction: 'row', labelWidth: SEAT_LABEL_W });
}

// The starting-stack control body: a "$" readout with the slider to its right, together
// the width of a seat row's creator+model columns.
function stackControl(): Node {
  return Box({ flexDirection: 'row', gap: 1, alignItems: 'start' }, [
    Box({ width: STACK_READOUT_W }, [Text({ text: money(startingStack), style: { color: HERO_FG } })]),
    Slot(stackSlider.id),
  ]);
}

// One seat's row: a "Seat N" label tinted in the creator's brand hue + the creator
// and model pickers side by side. `seatNo` is the 1-based table seat this config fills.
function seatRow(side: ModelSeatPicker, seatNo: number): Node {
  return Field({ label: `seat ${seatNo}`, child: modelSeatControls(side), direction: 'row', labelWidth: SEAT_LABEL_W, labelStyle: { color: modelSeatTint(side), bold: true } });
}

// Build the top-left settings panel: title, mode + players, then one row per AI seat
// (and a static "you" row for the hero's seat). No card background — the rows float
// over the scene; only the controls carry their own pill fills. Seat configs not
// currently shown keep their dropdown Slots mounted (hidden in a 0×0 box) so the
// Screen doesn't unmount them. Starting is the bottom-left "start match" button (built
// by the HUD), not a button here; Esc closes.
export function buildPokerSetupPanel(healthStatus?: { lines: string[]; failed: boolean }, gatewayNote?: string[]): Node {
  const shownIdx = shownIndices();
  const visibleSides = new Set(shownIdx.map((index) => sideForIndex(index)));
  const seatRows: Node[] = [];
  if (!spectating()) {
    seatRows.push(
      Box({ flexDirection: 'row', gap: 1, alignItems: 'start' }, [
        Box({ width: SEAT_LABEL_W }, [Text({ text: 'seat 1', style: { color: HERO_FG, bold: true } })]),
        Text({ text: 'you', style: { color: HERO_FG } }),
      ]),
    );
  }
  seatRows.push(...shownIdx.map((i) => seatRow(sideForIndex(i), i + 1))); // config i fills table seat i+1
  const hidden = sides
    .filter((side) => !visibleSides.has(side))
    .map(hiddenModelSeat);

  return Box({ flexDirection: 'column', gap: 1, alignItems: 'start' }, [
    matchSetupHeading(),
    row('mode', Slot('poker-setup-mode')),
    row('players', Slot('poker-players')),
    row('stack', stackControl()),
    ...seatRows,
    ...(healthStatus ? healthStatus.lines.map((text) => Text({ text, style: { color: healthStatus.failed ? 'danger' : 'muted' } })) : []),
    ...(gatewayNote?.length ? [Box({ flexDirection: 'column' }, gatewayNote.map((text) => Text({ text, style: { color: 'muted' } })))] : []),
    ...hidden,
  ]);
}
