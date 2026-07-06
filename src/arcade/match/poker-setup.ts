// The poker match setup modal: choose how many AI opponents (1..5 → a 2..6 seat
// table; heads-up is the default) and a provider → model for each. You (the human
// hero) are always seat 0. Mirrors the chess setup modal (match/setup.ts): each AI
// seat is two collapsing Dropdowns (provider above model) over the baked Gateway
// catalog, with state on module-level instances so it survives the per-frame
// rebuild (mounted via Slot). Start is enabled once every SHOWN seat has a model.

import { Box, Button, Dropdown, Modal, Slot, Text, type LayoutBox, type Node, type Screen, type Style } from '../../tui/index.ts';
import type { RGB } from '../../engine/index.ts';
import { modelsFor, type ModelInfo, providers } from './models.ts';
import { providerTint } from '../scenes/wisp.ts';
import type { PokerSeatSpec } from './poker-driver.ts';

const PROVS = providers();
const PROVIDER_LABELS = PROVS.map((p) => p.name);
const LIST_ROWS = 7;
const PROVIDER_W = 16;
const MODEL_W = 22;
const MAX_OPP = 5; // up to a 6-seat table (you + 5)

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
    onSelect: (i) => pickProvider(side, PROVS[i].slug),
  });
  const modelDropdown = new Dropdown({
    id: `${idPrefix}-model`,
    items: [],
    width: MODEL_W,
    rows: LIST_ROWS,
    placeholder: 'pick a model…',
    onSelect: (i) => {
      side.modelId = side.models[i]?.id ?? null;
    },
  });
  side = { provider: null, models: [], modelId: null, providerDropdown, modelDropdown };
  pickProvider(side, defaultProvider);
  const i = side.models.findIndex((m) => m.id === defaultModelId);
  if (i >= 0) modelDropdown.pick(i);
  return side;
}

// Default opponents, pre-committed so Start is enabled immediately (demo-friendly);
// re-pick any provider/model to change them.
const DEFAULT_MODELS = [
  ['anthropic', 'anthropic/claude-haiku-4.5'],
  ['openai', 'openai/gpt-5.4-nano'],
  ['google', 'google/gemini-2.5-flash'],
  ['anthropic', 'anthropic/claude-haiku-4.5'],
  ['openai', 'openai/gpt-5.4-nano'],
] as const;
const sides: AiSide[] = DEFAULT_MODELS.map(([prov, model], i) => makeSide(`poker-opp${i}`, prov, model));

// How many opponents are shown (1..MAX_OPP).
const countDropdown = new Dropdown({
  id: 'poker-oppcount',
  items: Array.from({ length: MAX_OPP }, (_, i) => String(i + 1)),
  width: 6,
  index: 0, // default: 1 opponent (heads-up)
});
function oppCount(): number {
  return (countDropdown.index < 0 ? 0 : countDropdown.index) + 1;
}

export function mountPokerSetup(ui: Screen): void {
  ui.mount(countDropdown);
  for (const s of sides) {
    ui.mount(s.providerDropdown);
    ui.mount(s.modelDropdown);
  }
}

// Ready when every shown opponent has a committed model.
export function pokerSetupReady(): boolean {
  return sides.slice(0, oppCount()).every((s) => s.modelId !== null);
}

// The chosen seats: the human hero (seat 0) + each shown opponent's model, or null
// if any shown opponent lacks a model.
export function pokerSetupSelection(): PokerSeatSpec[] | null {
  if (!pokerSetupReady()) return null;
  const seats: PokerSeatSpec[] = [{ kind: 'human' }];
  for (const s of sides.slice(0, oppCount())) seats.push({ kind: 'ai', model: s.modelId! });
  return seats;
}

const START_ON: Style = {
  padding: [0, 3],
  background: [86, 64, 120],
  color: [238, 230, 250],
  bold: true,
  hover: { background: [110, 84, 150] },
  focus: { background: [110, 84, 150] },
  pressed: { background: [120, 124, 142] },
};
const START_OFF: Style = { padding: [0, 3], background: [34, 36, 44], color: [110, 114, 126], bold: true };
const CANCEL: Style = {
  padding: [0, 2],
  background: [40, 42, 52],
  color: [212, 214, 224],
  hover: { background: [72, 76, 92] },
  focus: { background: [72, 76, 92] },
};

function brandTint(side: AiSide): RGB {
  if (!side.provider) return [212, 214, 224];
  const t = providerTint(side.provider);
  return [t.x | 0, t.y | 0, t.z | 0];
}

// One opponent column: a title tinted in the provider's brand hue + the two pickers.
function column(side: AiSide, seatNo: number): Node {
  side.providerDropdown.setAccent(brandTint(side));
  return Box({ flexDirection: 'column', gap: 0, width: MODEL_W }, [
    Box({ justifyContent: 'center' }, [Text({ text: `Seat ${seatNo}`, style: { color: brandTint(side), bold: true } })]),
    Box({ height: 0 }),
    Text({ text: 'Provider', style: { color: 'muted' } }),
    Slot(side.providerDropdown.id),
    Text({ text: 'Model', style: { color: 'muted' } }),
    Slot(side.modelDropdown.id),
  ]);
}

// Build the centered poker setup modal. Opponents beyond the chosen count keep their
// dropdown Slots mounted (hidden in a 0×0 box) so the Screen doesn't unmount them.
export function buildPokerSetup(_region: LayoutBox, opts: { onStart: () => void; onCancel: () => void }): Node {
  const count = oppCount();
  const ready = pokerSetupReady();
  const start = Button({ id: 'poker-start', label: 'Start game', onClick: ready ? opts.onStart : undefined, style: ready ? START_ON : START_OFF });
  const cancel = Button({ id: 'poker-cancel', label: 'Cancel', onClick: opts.onCancel, style: CANCEL });

  const shown = sides.slice(0, count).map((s, i) => column(s, i + 1));
  const hidden = sides.slice(count).map((s) => Box({ width: 0, height: 0, overflow: 'hidden' }, [Slot(s.providerDropdown.id), Slot(s.modelDropdown.id)]));

  const card = Box({ flexDirection: 'column', gap: 1, padding: [1, 3], background: [22, 24, 32] }, [
    Box({ justifyContent: 'center' }, [Text({ text: 'New poker match', style: { color: [222, 224, 234], bold: true } })]),
    Box({ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 2 }, [
      Text({ text: 'Opponents', style: { color: 'muted' } }),
      Slot('poker-oppcount'),
      Text({ text: 'You play seat 1', style: { color: 'muted' } }),
    ]),
    Box({ flexDirection: 'row', gap: 3, alignItems: 'start', justifyContent: 'center' }, [...shown, ...hidden]),
    Box({ flexDirection: 'row', justifyContent: 'center', gap: 2 }, [start, cancel]),
    Box({ justifyContent: 'center' }, [Text({ text: 'Tab move · Enter open/pick · ↑↓ scroll · Esc close', style: { color: 'muted' } })]),
  ]);
  return Modal(card);
}
