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
import { includeEarlyAccessModels, pickerCreators } from './models.ts';
import { availableRealtimeModels, DEFAULT_REALTIME_MODEL_ID } from '../../voice/index.ts';
import { shortModel } from '../../harness/model-label.ts';
import { BIG_BLIND, type PokerSeatSpec } from './poker-driver.ts';
import { pokerVoiceCapable } from './poker-voice.ts';
import type { PokerSeatView } from '../games/poker/poker-scene.ts';
import { ARCADE_CHROME_TEXT } from '../theme.ts';
import { createModelSeatPicker, hiddenModelSeat, modelSeatControls, modelSeatTint, mountModelSeat, setModelSeatCreators, type ModelCreator, type ModelSeatPicker } from './model-seat-picker.ts';

let TEXT_CREATORS: ModelCreator[] = pickerCreators();
let REALTIME_CREATORS: ModelCreator[] = [];
for (const model of availableRealtimeModels(includeEarlyAccessModels())) {
  let creator = REALTIME_CREATORS.find((candidate) => candidate.slug === model.creator);
  if (!creator) {
    creator = { slug: model.creator, name: model.creatorName, models: [] };
    REALTIME_CREATORS.push(creator);
  }
  creator.models.push({ id: model.id, name: model.name });
}
const CREATOR_W = 22;
const MODEL_W = 22;
const MAX_OPP = 5; // up to a 6-seat table (you + 5)
const SEAT_LABEL_W = 10; // wide enough for "model type"; all controls stay aligned

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

// Per-seat model configs, pre-committed so "start match" is live immediately; re-pick
// any creator/model to change them. Index 0 is seat 1's config — used only in SPECTATE
// mode (where seat 1 is an AI too); in HERO mode you play seat 1 and indices 1..MAX_OPP
// are your opponents (seats 2..6). The first three AI seats span claude / gpt / gemini;
// index 0 is a cheap fast Grok, so the default 4-handed spectate table seats four
// DIFFERENT creators instead of repeating one.
const DEFAULT_MODELS = [
  ['xai', 'xai/grok-4.1-fast-non-reasoning'],
  ['anthropic', 'anthropic/claude-haiku-4.5'],
  ['openai', 'openai/gpt-5.4-nano'],
  ['google', 'google/gemini-2.5-flash'],
  ['xai', 'xai/grok-4.1-fast-non-reasoning'],
  ['anthropic', 'anthropic/claude-haiku-4.5'],
] as const;
const sides: ModelSeatPicker[] = DEFAULT_MODELS.map(([prov, model], i) =>
  createModelSeatPicker({ idPrefix: `poker-opp${i}`, creators: TEXT_CREATORS, defaultCreator: prov, defaultModelId: model, onChange: changed }),
);
const realtimeSide = createModelSeatPicker({ idPrefix: 'poker-realtime-opp', creators: REALTIME_CREATORS, defaultCreator: 'openai', defaultModelId: DEFAULT_REALTIME_MODEL_ID, onChange: changed });

export function setPokerSetupModelCatalog(
  textCreators: readonly ModelCreator[],
  realtimeCreators: readonly ModelCreator[],
): void {
  TEXT_CREATORS = [...textCreators];
  REALTIME_CREATORS = [...realtimeCreators];
  for (const side of sides) setModelSeatCreators(side, TEXT_CREATORS);
  setModelSeatCreators(realtimeSide, REALTIME_CREATORS);
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

// Model type only applies to heads-up Play. Text uses the standard model catalog;
// Realtime voice uses the speech-to-speech catalog and the selected model is the
// actual opponent that speaks and acts.
export const modelTypeDropdown = new Dropdown({
  id: 'poker-model-type',
  items: ['text', 'realtime voice'],
  width: 18,
  index: 1,
  onSelect: () => changed(),
});
function modelTypeApplicable(): boolean {
  return !spectating() && oppCount() === 1; // Play mode, 2 players (you + one AI)
}
function realtimeSelected(): boolean {
  return modelTypeApplicable() && modelTypeDropdown.index === 1;
}
function sideForIndex(index: number): ModelSeatPicker {
  return realtimeSelected() && index === 1 ? realtimeSide : sides[index];
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
  ui.mount(modelTypeDropdown);
  ui.mount(stackSlider);
  for (const side of [...sides, realtimeSide]) mountModelSeat(ui, side);
}

// Ready when every shown seat's config has a committed model.
export function pokerSetupReady(): boolean {
  const committed = shownIndices().every((i) => sideForIndex(i).modelId !== null);
  return committed && (!realtimeSelected() || pokerVoiceCapable());
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
    seats.push({ kind: 'ai', model: side.modelId!, runtime: realtimeSelected() ? 'realtime' : 'text' });
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

const TITLE_FG: RGB = ARCADE_CHROME_TEXT.title;
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
export function buildPokerSetupPanel(): Node {
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
  const hidden = [...sides, realtimeSide]
    .filter((side) => !visibleSides.has(side))
    .map(hiddenModelSeat);
  // Model type only applies to heads-up Play; keep its Slot mounted when hidden.
  const modelTypeShown = modelTypeApplicable();
  const realtimeUnavailable = modelTypeShown && realtimeSelected() && !pokerVoiceCapable();
  if (!modelTypeShown) {
    hidden.push(Box({ width: 0, height: 0, overflow: 'hidden' }, [Slot('poker-model-type')]));
  }

  return Box({ flexDirection: 'column', gap: 1, alignItems: 'start' }, [
    Text({ text: 'new match', style: { color: TITLE_FG, bold: true } }),
    row('mode', Slot('poker-setup-mode')),
    row('players', Slot('poker-players')),
    row('stack', stackControl()),
    ...(modelTypeShown ? [row('model type', Slot('poker-model-type'))] : []),
    ...(realtimeUnavailable ? [row('', Text({ text: 'realtime voice unavailable', style: { color: 'muted' } }))] : []),
    ...seatRows,
    ...hidden,
  ]);
}
