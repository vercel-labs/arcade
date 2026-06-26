// The AI match setup modal: pick a provider → model for White and for Black, then
// Start. Each side is two collapsing Dropdowns (provider above model) over the
// baked Gateway catalog (models.ts) — closed, they show just the current choice,
// so the modal stays compact instead of spilling two long lists per side. The
// dropdown state lives on module-level instances + `Side` records so it survives
// the per-frame rebuild (mounted via Slot like the move panel). Start is enabled
// only once BOTH sides have a model committed; picking a different provider clears
// that side's model (re-picking the same provider, or a different model under it,
// leaves the provider intact).
import { Box, Button, Dropdown, Modal, Slot, Text, type LayoutBox, type Node, type Screen, type Style } from '../tui/index.ts';
import type { RGB } from '../engine/index.ts';
import { modelsFor, type ModelInfo, providers } from './models.ts';
import { providerTint } from './wisp.ts';

const PROVS = providers();
const PROVIDER_LABELS = PROVS.map((p) => p.name);
const LIST_ROWS = 7; // visible rows when a dropdown is open (lists scroll past this)
const PROVIDER_W = 18;
const MODEL_W = 26;

interface Side {
  readonly key: 'white' | 'black';
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

// Set a side's provider: repopulate its model list and clear the committed model.
// A no-op when the provider is unchanged, so re-picking it (or moving within its
// models) doesn't wipe the selection.
function pickProvider(side: Side, slug: string): void {
  if (side.provider === slug) return;
  side.provider = slug;
  side.models = modelsFor(slug);
  side.modelDropdown.setItems(side.models.map((m) => m.name)); // resets model → none
  side.modelId = null;
}

function makeSide(key: 'white' | 'black', defaultProvider: string, defaultModelId?: string): Side {
  // onSelect closures reference `side`, assigned just below — they only fire on
  // later user interaction, so the forward reference is safe.
  let side: Side;
  const providerDropdown = new Dropdown({
    id: `setup-${key}-provider`,
    items: PROVIDER_LABELS,
    width: PROVIDER_W,
    rows: LIST_ROWS,
    index: providerIndex(defaultProvider), // a provider is pre-chosen…
    onSelect: (i) => pickProvider(side, PROVS[i].slug),
  });
  const modelDropdown = new Dropdown({
    id: `setup-${key}-model`,
    items: [],
    width: MODEL_W,
    rows: LIST_ROWS,
    placeholder: 'pick a model…', // …but the model must be chosen explicitly
    onSelect: (i) => {
      side.modelId = side.models[i]?.id ?? null;
    },
  });
  side = { key, provider: null, models: [], modelId: null, providerDropdown, modelDropdown };
  pickProvider(side, defaultProvider); // populate the model list (modelId stays null)
  if (defaultModelId) {
    const i = side.models.findIndex((m) => m.id === defaultModelId);
    if (i >= 0) modelDropdown.pick(i); // commit the default model → sets side.modelId
  }
  return side;
}

// TEMP (demo): pre-commit a full matchup — Claude Haiku 4.5 vs GPT 5.4 Nano — so the
// modal opens with Start already enabled. To go back to "pick a model yourself",
// drop the third arg from each makeSide call (providers stay pre-selected).
const white = makeSide('white', 'anthropic', 'anthropic/claude-haiku-4.5');
const black = makeSide('black', 'openai', 'openai/gpt-5.4-nano');

export function mountMatchSetup(ui: Screen): void {
  for (const s of [white, black]) {
    ui.mount(s.providerDropdown);
    ui.mount(s.modelDropdown);
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

// A side's brand hue (the provider's wisp color), as an RGB tuple for the field.
function brandTint(side: Side): RGB {
  if (!side.provider) return [212, 214, 224];
  const t = providerTint(side.provider);
  return [t.x | 0, t.y | 0, t.z | 0];
}

function column(side: Side, title: string): Node {
  // Tint the provider field in the provider's brand hue (the same color its wisp
  // takes in-game), set fresh each frame since the provider can change.
  side.providerDropdown.setAccent(brandTint(side));
  return Box({ flexDirection: 'column', gap: 0, width: MODEL_W }, [
    Box({ justifyContent: 'center' }, [Text({ text: title, style: { color: TITLE_TINT[side.key], bold: true } })]),
    Box({ height: 0 }), // a blank line under the title
    Text({ text: 'Provider', style: { color: 'muted' } }),
    Slot(side.providerDropdown.id),
    Text({ text: 'Model', style: { color: 'muted' } }),
    Slot(side.modelDropdown.id),
  ]);
}

// Build the centered setup modal. `onStart` is wired to the Start button only when
// both sides are ready; otherwise the button is rendered disabled (no onClick).
export function buildMatchSetup(_region: LayoutBox, opts: { onStart: () => void; onCancel: () => void }): Node {
  const ready = matchSetupReady();
  const start = Button({ id: 'setup-start', label: 'Start game', onClick: ready ? opts.onStart : undefined, style: ready ? START_ON : START_OFF });
  const cancel = Button({ id: 'setup-cancel', label: 'Cancel', onClick: opts.onCancel, style: CANCEL });

  // alignItems:'start' would clip a list opening in the shorter column, so the
  // columns are top-aligned and the row grows to the taller (open) one.
  const card = Box({ flexDirection: 'column', gap: 1, padding: [1, 3], background: [22, 24, 32] }, [
    Box({ justifyContent: 'center' }, [Text({ text: 'New AI match', style: { color: [222, 224, 234], bold: true } })]),
    Box({ flexDirection: 'row', gap: 4, alignItems: 'start' }, [column(white, 'White'), column(black, 'Black')]),
    Box({ flexDirection: 'row', justifyContent: 'center', gap: 2 }, [start, cancel]),
    Box({ justifyContent: 'center' }, [Text({ text: 'Tab move · Enter open/pick · ↑↓ scroll · Esc close', style: { color: 'muted' } })]),
  ]);
  return Modal(card);
}
