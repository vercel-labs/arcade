// The AI match setup modal: pick a provider → model for White and for Black, then
// Start. Two columns of scrollable Selects over the baked Gateway catalog
// (models.ts). The provider/model state lives on module-level Select instances +
// `Side` records so it survives the per-frame rebuild (mounted via Slot like the
// move panel). Start is enabled only once BOTH sides have a model committed;
// picking a different provider clears that side's model (picking the same one, or
// a different model under the same provider, leaves the provider intact).
import { Box, Button, Modal, Select, Slot, Text, type LayoutBox, type Node, type Screen, type Style } from '../tui/index.ts';
import type { RGB } from '../engine/index.ts';
import { modelName, modelsFor, type ModelInfo, providerName, providers } from './models.ts';
import { providerTint } from './wisp.ts';

const PROVS = providers();
const PROVIDER_LABELS = PROVS.map((p) => p.name);
const SELECT_H = 8; // visible rows per select (lists scroll)

interface Side {
  readonly key: 'white' | 'black';
  readonly providerSelect: Select;
  readonly modelSelect: Select;
  provider: string | null;
  models: ModelInfo[];
  modelId: string | null;
}

function providerIndex(slug: string): number {
  const i = PROVS.findIndex((p) => p.slug === slug);
  return i < 0 ? 0 : i;
}

// Set a side's provider: repopulate its model list and clear the committed model.
// A no-op when the provider is unchanged, so re-picking it (or moving within its
// models) doesn't wipe the selection.
function pickProvider(side: Side, slug: string): void {
  if (side.provider === slug) return;
  side.provider = slug;
  side.models = modelsFor(slug);
  side.modelSelect.setItems(side.models.map((m) => m.name));
  side.modelId = null;
}

function makeSide(key: 'white' | 'black', defaultProvider: string): Side {
  // onSelect closures reference `side`, which is assigned just below — they only
  // fire on later user interaction, so the forward reference is safe.
  let side: Side;
  const providerSelect = new Select({
    id: `setup-${key}-provider`,
    items: PROVIDER_LABELS,
    height: SELECT_H,
    width: 16,
    index: providerIndex(defaultProvider),
    onSelect: (i) => pickProvider(side, PROVS[i].slug),
  });
  const modelSelect = new Select({
    id: `setup-${key}-model`,
    items: [],
    height: SELECT_H,
    width: 26,
    onSelect: (i) => {
      side.modelId = side.models[i]?.id ?? null;
    },
  });
  side = { key, provider: null, models: [], modelId: null, providerSelect, modelSelect };
  pickProvider(side, defaultProvider); // populate the model list (modelId stays null)
  return side;
}

// Default to a Claude vs GPT matchup (two distinct provider wisps). Providers are
// pre-selected so the model lists show; a model must still be picked for each.
const white = makeSide('white', 'anthropic');
const black = makeSide('black', 'openai');

export function mountMatchSetup(ui: Screen): void {
  for (const s of [white, black]) {
    ui.mount(s.providerSelect);
    ui.mount(s.modelSelect);
  }
}

// Both sides have a committed model — the only state in which Start is enabled.
export function matchSetupReady(): boolean {
  return white.modelId !== null && black.modelId !== null;
}

// The chosen model slugs, once ready (white, black).
export function matchSetupSelection(): { white: string; black: string } | null {
  if (!white.modelId || !black.modelId) return null;
  return { white: white.modelId, black: black.modelId };
}

const TITLE_TINT: Record<Side['key'], RGB> = { white: [232, 228, 216], black: [184, 126, 74] };
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

function summary(side: Side): { text: string; tint: RGB } {
  if (!side.provider) return { text: '—', tint: [120, 124, 136] };
  const t = providerTint(side.provider);
  const tint: RGB = [t.x | 0, t.y | 0, t.z | 0];
  const model = side.modelId ? modelName(side.modelId) : '(pick a model)';
  return { text: `${providerName(side.provider)} · ${model}`, tint };
}

function column(side: Side, title: string): Node {
  const sum = summary(side);
  return Box({ flexDirection: 'column', gap: 0, width: 28 }, [
    Box({ justifyContent: 'center' }, [Text({ text: title, style: { color: TITLE_TINT[side.key], bold: true } })]),
    Text({ text: 'Provider', style: { color: 'muted' } }),
    Slot(side.providerSelect.id),
    Text({ text: 'Model', style: { color: 'muted' } }),
    Slot(side.modelSelect.id),
    Text({ text: sum.text, style: { color: sum.tint } }),
  ]);
}

// Build the centered setup modal. `onStart` is wired to the Start button only when
// both sides are ready; otherwise the button is rendered disabled (no onClick).
export function buildMatchSetup(_region: LayoutBox, opts: { onStart: () => void; onCancel: () => void }): Node {
  const ready = matchSetupReady();
  const start = Button({ id: 'setup-start', label: 'Start game', onClick: ready ? opts.onStart : undefined, style: ready ? START_ON : START_OFF });
  const cancel = Button({ id: 'setup-cancel', label: 'Cancel', onClick: opts.onCancel, style: CANCEL });

  const card = Box({ flexDirection: 'column', gap: 1, padding: [1, 3], background: [22, 24, 32] }, [
    Box({ justifyContent: 'center' }, [Text({ text: 'New AI match', style: { color: [222, 224, 234], bold: true } })]),
    Box({ flexDirection: 'row', gap: 4, alignItems: 'start' }, [column(white, 'White'), column(black, 'Black')]),
    Box({ flexDirection: 'row', justifyContent: 'center', gap: 2 }, [start, cancel]),
    Box({ justifyContent: 'center' }, [Text({ text: 'Tab to move · ↑↓ choose · Enter select · Esc cancel', style: { color: 'muted' } })]),
  ]);
  return Modal(card);
}
