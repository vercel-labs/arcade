// The poker match setup: an in-scene settings panel stacked down the top-left of the
// table view (no modal, no scrim — the felt stays interactive behind it). Choose the
// mode (you play vs. spectate), the player count (2..6 seats, you included), and a
// creator → model per AI seat. Every choice is pre-committed to a sensible default so
// the bottom-left "start match" button is live immediately. State lives on module-level
// instances so it survives the per-frame rebuild (mounted via Slot). The table behind
// previews the choices live — chairs follow the player count and each AI seat's wisp
// follows its creator — via the onChanged hook (main wires it to scene.setPreview).

import { Box, Button, Dropdown, Slider, Slot, Text, type Node, type Screen } from '../../tui/index.ts';
import type { RGB } from '../../engine/index.ts';
import { includeEarlyAccessModels, pickerCreators, type ModelInfo } from './models.ts';
import { availableRealtimeModels, DEFAULT_REALTIME_MODEL_ID } from '../../voice/index.ts';
import { SLOW_MODELS } from './beta-allowlist.ts';
import { creatorTint } from '../scenes/wisp.ts';
import { shortModel } from '../games/chess/hud.ts';
import { BIG_BLIND, type PokerSeatSpec } from './poker-driver.ts';
import { pokerVoiceCapable } from './poker-voice.ts';
import type { PokerSeatView } from '../games/poker/poker-scene.ts';
import { ARCADE_CHROME_TEXT, ARCADE_OUTLINE_CONTROL } from '../theme.ts';

interface AiCreator {
  slug: string;
  name: string;
  models: ModelInfo[];
}

const TEXT_CREATORS: AiCreator[] = pickerCreators();
const REALTIME_CREATORS: AiCreator[] = [];
for (const model of availableRealtimeModels(includeEarlyAccessModels())) {
  let creator = REALTIME_CREATORS.find((candidate) => candidate.slug === model.creator);
  if (!creator) {
    creator = { slug: model.creator, name: model.creatorName, models: [] };
    REALTIME_CREATORS.push(creator);
  }
  creator.models.push({ id: model.id, name: model.name });
}
const LIST_ROWS = 7;
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

interface AiSide {
  readonly creators: readonly AiCreator[];
  readonly creatorDropdown: Dropdown;
  readonly modelDropdown: Dropdown;
  readonly randomId: string; // the seat's "↻ random" affordance id
  creator: string | null;
  models: ModelInfo[];
  modelId: string | null;
}

function creatorIndex(creators: readonly AiCreator[], slug: string): number {
  const i = creators.findIndex((c) => c.slug === slug);
  return i < 0 ? 0 : i;
}

// Drop a random creator+model combo into a seat. Drives the seat's own dropdowns
// via pick() (clearing `creator` first so an unchanged creator still repopulates),
// so pickCreator + the model handler + changed() all fire and the field, model
// list, and live preview update exactly as a manual pick would. Prefers a combo
// different from the current one (bounded retries) so a click always feels like it
// did something; every offered combo is pre-validated by pickerCreators().
function randomizeSide(side: AiSide): void {
  const creators = side.creators;
  if (creators.length === 0) return;
  const prev = side.modelId;
  for (let attempt = 0; attempt < 8; attempt++) {
    const c = creators[(Math.random() * creators.length) | 0];
    if (c.models.length === 0) continue;
    const m = c.models[(Math.random() * c.models.length) | 0];
    if (m.id === prev && attempt < 7) continue; // avoid re-picking the current model when we can
    side.creator = null;
    side.creatorDropdown.pick(creatorIndex(creators, c.slug));
    const i = side.models.findIndex((mm) => mm.id === m.id);
    if (i >= 0) side.modelDropdown.pick(i);
    return;
  }
}

function pickCreator(side: AiSide, slug: string): void {
  if (side.creator === slug) return;
  side.creator = slug;
  side.models = side.creators.find((creator) => creator.slug === slug)?.models ?? [];
  side.modelDropdown.setItems(side.models.map((m) => m.name));
  side.modelId = null;
}

function makeSide(idPrefix: string, creators: readonly AiCreator[], defaultCreator: string, defaultModelId: string): AiSide {
  let side: AiSide;
  const creatorDropdown = new Dropdown({
    searchable: true,
    searchPlaceholder: 'Search',
    id: `${idPrefix}-creator`,
    items: creators.map((creator) => creator.name),
    width: CREATOR_W,
    rows: LIST_ROWS,
    index: creatorIndex(creators, defaultCreator),
    onSelect: (i) => {
      pickCreator(side, creators[i].slug);
      changed();
    },
  });
  const modelDropdown = new Dropdown({
    searchable: true,
    searchPlaceholder: 'Search',
    id: `${idPrefix}-model`,
    items: [],
    width: MODEL_W,
    rows: LIST_ROWS,
    placeholder: 'pick a model…',
    onSelect: (i) => {
      side.modelId = side.models[i]?.id ?? null;
      changed();
    },
  });
  side = { creators, creator: null, models: [], modelId: null, creatorDropdown, modelDropdown, randomId: `${idPrefix}-random` };
  pickCreator(side, defaultCreator);
  const i = side.models.findIndex((m) => m.id === defaultModelId);
  if (i >= 0) modelDropdown.pick(i);
  return side;
}

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
const sides: AiSide[] = DEFAULT_MODELS.map(([prov, model], i) =>
  makeSide(`poker-opp${i}`, TEXT_CREATORS, prov, model),
);
const realtimeSide = makeSide(
  'poker-realtime-opp', REALTIME_CREATORS, 'openai', DEFAULT_REALTIME_MODEL_ID,
);

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
function sideForIndex(index: number): AiSide {
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
  for (const s of sides) {
    ui.mount(s.creatorDropdown);
    ui.mount(s.modelDropdown);
  }
  ui.mount(realtimeSide.creatorDropdown);
  ui.mount(realtimeSide.modelDropdown);
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
  const ai = (side: AiSide): PokerSeatView => ({
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
const SLOW_FG: RGB = [210, 168, 90]; // amber hint for slow-but-working models
const RANDOM_HOVER_FG: RGB = [255, 255, 255]; // "↻ random" brightens on hover/focus

// A muted "↻ random" affordance beside a seat's model picker — one click rerolls
// the seat to a random creator+model, surfacing the breadth of the catalog. Rests
// at 'muted' grey and brightens to white on hover/focus (the dialog-affordance
// convention); no tooltip needed since the label says what it does.
function randomBadge(side: AiSide): Node {
  return Button({
    id: side.randomId,
    label: '↻ random',
    onClick: () => randomizeSide(side),
    style: { padding: [0, 0], color: 'muted', hover: { color: RANDOM_HOVER_FG }, focus: { color: RANDOM_HOVER_FG } },
  });
}

// A dim "slow" hint shown beside a seat's model when it's a known-slow pick
// (SLOW_MODELS) — it still plays, just takes a while (mostly poker). Node[] so it
// spreads cleanly into a row and is nothing when the model is fast.
function slowBadge(modelId: string | null): Node[] {
  return modelId && SLOW_MODELS.has(modelId)
    ? [Text({ text: '(slow)', style: { color: SLOW_FG } })]
    : [];
}

function brandTint(side: AiSide): RGB {
  if (!side.creator) return ARCADE_OUTLINE_CONTROL.neutralText;
  const t = creatorTint(side.creator);
  return [t.x | 0, t.y | 0, t.z | 0];
}

// A settings line: a muted label gutter + the control, so the columns align.
function row(label: string, control: Node): Node {
  return Box({ flexDirection: 'row', gap: 1, alignItems: 'start' }, [
    Box({ width: SEAT_LABEL_W }, [Text({ text: label, style: { color: 'muted' } })]),
    control,
  ]);
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
function seatRow(side: AiSide, seatNo: number): Node {
  side.creatorDropdown.setAccent(brandTint(side));
  return Box({ flexDirection: 'row', gap: 1, alignItems: 'start' }, [
    Box({ width: SEAT_LABEL_W }, [Text({ text: `seat ${seatNo}`, style: { color: brandTint(side), bold: true } })]),
    Slot(side.creatorDropdown.id),
    Slot(side.modelDropdown.id),
    randomBadge(side),
    ...slowBadge(side.modelId),
  ]);
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
    .map((side) => Box({ width: 0, height: 0, overflow: 'hidden' }, [Slot(side.creatorDropdown.id), Slot(side.modelDropdown.id)]));
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
