// The poker match setup: an in-scene settings panel stacked down the top-left of the
// table view (no modal, no scrim — the felt stays interactive behind it). Choose the
// mode (you play vs. spectate), the player count (2..6 seats, you included), and a
// provider → model per AI seat. Every choice is pre-committed to a sensible default so
// the bottom-left "start match" button is live immediately. State lives on module-level
// instances so it survives the per-frame rebuild (mounted via Slot). The table behind
// previews the choices live — chairs follow the player count and each AI seat's wisp
// follows its provider — via the onChanged hook (main wires it to scene.setPreview).

import { Box, Dropdown, Slider, Slot, Text, type Node, type Screen } from '../../tui/index.ts';
import type { RGB } from '../../engine/index.ts';
import { modelsFor, type ModelInfo, providers } from './models.ts';
import { providerTint } from '../scenes/wisp.ts';
import { shortModel } from '../games/chess/hud.ts';
import { BIG_BLIND, type PokerSeatSpec } from './poker-driver.ts';
import type { PokerSeatView } from '../games/poker/poker-scene.ts';

const PROVS = providers();
const PROVIDER_LABELS = PROVS.map((p) => p.name);
const LIST_ROWS = 7;
const PROVIDER_W = 16;
const MODEL_W = 22;
const MAX_OPP = 5; // up to a 6-seat table (you + 5)
const SEAT_LABEL_W = 8; // the "Seat N" gutter, so the dropdown columns line up

// Fires on every committed change (mode / players / provider / model), so main can
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
  readonly providerDropdown: Dropdown;
  readonly modelDropdown: Dropdown;
  provider: string | null;
  models: ModelInfo[];
  modelId: string | null;
}

function providerIndex(slug: string): number {
  const i = PROVS.findIndex((p) => p.slug === slug);
  return i < 0 ? 0 : i;
}

function pickProvider(side: AiSide, slug: string): void {
  if (side.provider === slug) return;
  side.provider = slug;
  side.models = modelsFor(slug);
  side.modelDropdown.setItems(side.models.map((m) => m.name));
  side.modelId = null;
}

function makeSide(idPrefix: string, defaultProvider: string, defaultModelId: string): AiSide {
  let side: AiSide;
  const providerDropdown = new Dropdown({
    id: `${idPrefix}-provider`,
    items: PROVIDER_LABELS,
    width: PROVIDER_W,
    rows: LIST_ROWS,
    index: providerIndex(defaultProvider),
    onSelect: (i) => {
      pickProvider(side, PROVS[i].slug);
      changed();
    },
  });
  const modelDropdown = new Dropdown({
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
  side = { provider: null, models: [], modelId: null, providerDropdown, modelDropdown };
  pickProvider(side, defaultProvider);
  const i = side.models.findIndex((m) => m.id === defaultModelId);
  if (i >= 0) modelDropdown.pick(i);
  return side;
}

// Per-seat model configs, pre-committed so "start match" is live immediately; re-pick
// any provider/model to change them. Index 0 is seat 1's config — used only in SPECTATE
// mode (where seat 1 is an AI too); in HERO mode you play seat 1 and indices 1..MAX_OPP
// are your opponents (seats 2..6). The first three AI seats span claude / gpt / gemini;
// index 0 is a cheap fast Grok, so the default 4-handed spectate table seats four
// DIFFERENT providers instead of repeating one.
const DEFAULT_MODELS = [
  ['xai', 'xai/grok-4.1-fast-non-reasoning'],
  ['anthropic', 'anthropic/claude-haiku-4.5'],
  ['openai', 'openai/gpt-5.4-nano'],
  ['google', 'google/gemini-2.5-flash'],
  ['xai', 'xai/grok-4.1-fast-non-reasoning'],
  ['anthropic', 'anthropic/claude-haiku-4.5'],
] as const;
const sides: AiSide[] = DEFAULT_MODELS.map(([prov, model], i) => makeSide(`poker-opp${i}`, prov, model));

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
const STACK_SLIDER_W = PROVIDER_W + 1 + MODEL_W - STACK_READOUT_W - 1; // == a seat's control columns
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
  items: ['Play with AI', 'Spectate AI'],
  width: 16,
  index: 0,
  onSelect: () => changed(),
});
function spectating(): boolean {
  return modeDropdown.index === 1;
}

// Real-time voice mode — only meaningful for a heads-up human-vs-AI match (Play + 2
// players), where the AI opponent speaks and acts by voice and you can talk back. The
// toggle only appears in that case (see buildPokerSetupPanel); everywhere else voice is
// simply off. Defaults on so the feature is one click away, but falls back to the text
// path if a mic / Gateway key isn't available.
export const voiceDropdown = new Dropdown({
  id: 'poker-voice',
  items: ['Off', 'On'],
  width: 10,
  index: 1,
  onSelect: () => changed(),
});
function voiceApplicable(): boolean {
  return !spectating() && oppCount() === 1; // Play mode, 2 players (you + one AI)
}
// Whether the user asked for realtime voice for this match (only ever true heads-up).
export function pokerVoiceSelected(): boolean {
  return voiceApplicable() && voiceDropdown.index === 1;
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
  ui.mount(voiceDropdown);
  ui.mount(stackSlider);
  for (const s of sides) {
    ui.mount(s.providerDropdown);
    ui.mount(s.modelDropdown);
  }
}

// Ready when every shown seat's config has a committed model.
export function pokerSetupReady(): boolean {
  return shownIndices().every((i) => sides[i].modelId !== null);
}

// The chosen seats. HERO: seat 1 is the human, seats 2..N are the shown opponents.
// SPECTATE: every seat is an AI (seat 1 uses index 0's config). null if any shown
// config lacks a model.
export function pokerSetupSelection(): PokerSeatSpec[] | null {
  if (!pokerSetupReady()) return null;
  const seats: PokerSeatSpec[] = [spectating() ? { kind: 'ai', model: sides[0].modelId! } : { kind: 'human' }];
  for (let i = 1; i <= oppCount(); i++) seats.push({ kind: 'ai', model: sides[i].modelId! });
  return seats;
}

// The current choices as scene seat views, for the live idle-table preview: the chair
// ring follows the count and each AI seat's wisp follows its provider. A seat whose
// model is un-committed (provider re-picked, model pending) still previews by provider.
export function pokerPreviewSeats(): PokerSeatView[] {
  const ai = (side: AiSide): PokerSeatView => ({
    kind: 'ai',
    label: side.modelId ? shortModel(side.modelId) : side.provider ?? 'AI',
    provider: side.provider ?? undefined,
  });
  const seats: PokerSeatView[] = [spectating() ? ai(sides[0]) : { kind: 'human', label: 'You' }];
  for (let i = 1; i <= oppCount(); i++) seats.push(ai(sides[i]));
  return seats;
}

const TITLE_FG: RGB = [222, 224, 234];
const HERO_FG: RGB = [224, 226, 236];

function brandTint(side: AiSide): RGB {
  if (!side.provider) return [212, 214, 224];
  const t = providerTint(side.provider);
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
// the width of a seat row's provider+model columns.
function stackControl(): Node {
  return Box({ flexDirection: 'row', gap: 1, alignItems: 'start' }, [
    Box({ width: STACK_READOUT_W }, [Text({ text: money(startingStack), style: { color: HERO_FG } })]),
    Slot(stackSlider.id),
  ]);
}

// One seat's row: a "Seat N" label tinted in the provider's brand hue + the provider
// and model pickers side by side. `seatNo` is the 1-based table seat this config fills.
function seatRow(side: AiSide, seatNo: number): Node {
  side.providerDropdown.setAccent(brandTint(side));
  return Box({ flexDirection: 'row', gap: 1, alignItems: 'start' }, [
    Box({ width: SEAT_LABEL_W }, [Text({ text: `Seat ${seatNo}`, style: { color: brandTint(side), bold: true } })]),
    Slot(side.providerDropdown.id),
    Slot(side.modelDropdown.id),
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
  const shownSet = new Set(shownIdx);
  const seatRows: Node[] = [];
  if (!spectating()) {
    seatRows.push(
      Box({ flexDirection: 'row', gap: 1, alignItems: 'start' }, [
        Box({ width: SEAT_LABEL_W }, [Text({ text: 'Seat 1', style: { color: HERO_FG, bold: true } })]),
        Text({ text: 'you', style: { color: HERO_FG } }),
      ]),
    );
  }
  seatRows.push(...shownIdx.map((i) => seatRow(sides[i], i + 1))); // config i fills table seat i+1
  const hidden = sides
    .map((s, i) => ({ s, i }))
    .filter(({ i }) => !shownSet.has(i))
    .map(({ s }) => Box({ width: 0, height: 0, overflow: 'hidden' }, [Slot(s.providerDropdown.id), Slot(s.modelDropdown.id)]));
  // The voice toggle only shows heads-up (Play + 2 players); keep its Slot mounted but
  // hidden otherwise so the Screen doesn't unmount it (same trick as unshown seats).
  const voiceShown = voiceApplicable();
  if (!voiceShown) hidden.push(Box({ width: 0, height: 0, overflow: 'hidden' }, [Slot('poker-voice')]));

  return Box({ flexDirection: 'column', gap: 1, alignItems: 'start' }, [
    Text({ text: 'New match', style: { color: TITLE_FG, bold: true } }),
    row('Mode', Slot('poker-setup-mode')),
    row('Players', Slot('poker-players')),
    row('Stack', stackControl()),
    ...(voiceShown ? [row('Voice', Slot('poker-voice'))] : []),
    ...seatRows,
    ...hidden,
  ]);
}
