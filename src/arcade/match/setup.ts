// The AI match setup modal: pick a provider → model for White and for Black, then
// Start. Each side is two collapsing Dropdowns (provider above model) over the
// baked Gateway catalog (models.ts) — closed, they show just the current choice,
// so the modal stays compact instead of spilling two long lists per side. The
// dropdown state lives on module-level instances + `Side` records so it survives
// the per-frame rebuild (mounted via Slot like the move panel). Start is enabled
// only once BOTH sides have a model committed; picking a different provider clears
// that side's model (re-picking the same provider, or a different model under it,
// leaves the provider intact).
import { Box, Button, Dropdown, Modal, Slot, Text, type LayoutBox, type Node, type Screen, type Style } from '../../tui/index.ts';
import type { RGB } from '../../engine/index.ts';
import { modelsFor, type ModelInfo, providers } from './models.ts';
import { providerTint } from '../scenes/wisp.ts';
import type { Seat } from './driver.ts';

const PROVS = providers();
const PROVIDER_LABELS = PROVS.map((p) => p.name);
const LIST_ROWS = 7; // visible rows when a dropdown is open (lists scroll past this)
const PROVIDER_W = 18;
const MODEL_W = 26;

interface Side {
  key: 'white' | 'black'; // drives the title tint; mutable so the swap side can be reused for either color
  readonly providerDropdown: Dropdown;
  readonly modelDropdown: Dropdown;
  provider: string | null;
  models: ModelInfo[];
  modelId: string | null;
  human: boolean; // this side is a human at the keyboard (hides the provider/model pickers)
}

// Flip a side between an AI (the dropdowns) and a human at the board.
function setHuman(side: Side, human: boolean): void {
  side.human = human;
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

// `idPrefix` namespaces the two dropdown ids so several modals' sides can be
// mounted without colliding in the Screen registry (the two start-modal sides +
// the reusable swap side).
function makeSide(key: 'white' | 'black', idPrefix: string, defaultProvider: string, defaultModelId?: string): Side {
  // onSelect closures reference `side`, assigned just below — they only fire on
  // later user interaction, so the forward reference is safe.
  let side: Side;
  const providerDropdown = new Dropdown({
    id: `${idPrefix}-provider`,
    items: PROVIDER_LABELS,
    width: PROVIDER_W,
    rows: LIST_ROWS,
    index: providerIndex(defaultProvider), // a provider is pre-chosen…
    onSelect: (i) => pickProvider(side, PROVS[i].slug),
  });
  const modelDropdown = new Dropdown({
    id: `${idPrefix}-model`,
    items: [],
    width: MODEL_W,
    rows: LIST_ROWS,
    placeholder: 'pick a model…', // …but the model must be chosen explicitly
    onSelect: (i) => {
      side.modelId = side.models[i]?.id ?? null;
    },
  });
  side = { key, provider: null, models: [], modelId: null, human: false, providerDropdown, modelDropdown };
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
const white = makeSide('white', 'setup-white', 'anthropic', 'anthropic/claude-haiku-4.5');
const black = makeSide('black', 'setup-black', 'openai', 'openai/gpt-5.4-nano');

export function mountMatchSetup(ui: Screen): void {
  for (const s of [white, black]) {
    ui.mount(s.providerDropdown);
    ui.mount(s.modelDropdown);
  }
}

// Each side is ready when it's human OR has a committed model — the only state in
// which Start is enabled (a human side needs no model).
function sideReady(s: Side): boolean {
  return s.human || s.modelId !== null;
}
export function matchSetupReady(): boolean {
  return sideReady(white) && sideReady(black);
}

// The chosen seats, once both sides are ready (human, or an AI model slug).
export function matchSetupSelection(): { white: Seat; black: Seat } | null {
  const seat = (s: Side): Seat | null => (s.human ? { kind: 'human' } : s.modelId ? { kind: 'ai', model: s.modelId } : null);
  const w = seat(white);
  const b = seat(black);
  return w && b ? { white: w, black: b } : null;
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
// The per-side AI|Human segmented control: two adjacent pills (gap 0), the active
// one lit like Start, the inactive one dim (but hoverable/focusable).
const SEG_ON: Style = { padding: [0, 2], background: [86, 64, 120], color: [238, 230, 250], bold: true };
const SEG_OFF: Style = {
  padding: [0, 2],
  background: [40, 42, 52],
  color: [150, 154, 166],
  hover: { background: [60, 63, 76], color: [212, 214, 224] },
  focus: { background: [60, 63, 76] },
};

// A side's brand hue (the provider's wisp color), as an RGB tuple for the field.
function brandTint(side: Side): RGB {
  if (!side.provider) return [212, 214, 224];
  const t = providerTint(side.provider);
  return [t.x | 0, t.y | 0, t.z | 0];
}

// One side's column: the title, an optional AI|Human toggle (`showSeat` — the start
// modal has it, the swap popup doesn't), then either the provider/model pickers (AI)
// or a short "you play this side" note (human). `alignItems:'start'` on the row lets
// the two columns differ in height when one is human.
function column(side: Side, title: string, showSeat = false): Node {
  // Tint the provider field in the provider's brand hue (the same color its wisp
  // takes in-game), set fresh each frame since the provider can change.
  side.providerDropdown.setAccent(brandTint(side));
  const base = side.providerDropdown.id.replace(/-provider$/, ''); // e.g. 'setup-white' — namespaces the toggle ids
  const seat = showSeat
    ? Box({ flexDirection: 'row', justifyContent: 'center', gap: 0 }, [
        Button({ id: `${base}-ai`, label: 'ai', onClick: () => setHuman(side, false), style: side.human ? SEG_OFF : SEG_ON }),
        Button({ id: `${base}-human`, label: 'human', onClick: () => setHuman(side, true), style: side.human ? SEG_ON : SEG_OFF }),
      ])
    : null;
  const body: Node[] = side.human
    ? [
        Text({ text: 'you play this side', style: { color: 'muted' } }),
        // Keep the dropdown Slots in the tree (hidden, 0×0 clipped) so the Screen
        // doesn't auto-unmount their components — toggling back to AI must find them
        // still mounted, else the pickers come back empty.
        Box({ width: 0, height: 0, overflow: 'hidden' }, [Slot(side.providerDropdown.id), Slot(side.modelDropdown.id)]),
      ]
    : [
        Text({ text: 'provider', style: { color: 'muted' } }),
        Slot(side.providerDropdown.id),
        Text({ text: 'model', style: { color: 'muted' } }),
        Slot(side.modelDropdown.id),
      ];
  return Box({ flexDirection: 'column', gap: 0, width: MODEL_W }, [
    Box({ justifyContent: 'center' }, [Text({ text: title, style: { color: TITLE_TINT[side.key], bold: true } })]),
    ...(seat ? [Box({ height: 0 }), seat] : []),
    Box({ height: 0 }), // a blank line above the body
    ...body,
  ]);
}

// Build the centered setup modal. `onStart` is wired to the Start button only when
// both sides are ready; otherwise the button is rendered disabled (no onClick).
export function buildMatchSetup(_region: LayoutBox, opts: { onStart: () => void; onCancel: () => void }): Node {
  const ready = matchSetupReady();
  const start = Button({ id: 'setup-start', label: 'start game', onClick: ready ? opts.onStart : undefined, style: ready ? START_ON : START_OFF });
  const cancel = Button({ id: 'setup-cancel', label: 'cancel', onClick: opts.onCancel, style: CANCEL });

  // alignItems:'start' would clip a list opening in the shorter column, so the
  // columns are top-aligned and the row grows to the taller (open) one.
  const card = Box({ flexDirection: 'column', gap: 1, padding: [1, 3], background: [22, 24, 32] }, [
    Box({ justifyContent: 'center' }, [Text({ text: 'new match', style: { color: [222, 224, 234], bold: true } })]),
    Box({ flexDirection: 'row', gap: 4, alignItems: 'start' }, [column(white, 'white', true), column(black, 'black', true)]),
    Box({ flexDirection: 'row', justifyContent: 'center', gap: 2 }, [start, cancel]),
    Box({ justifyContent: 'center' }, [Text({ text: 'tab move · enter open/pick · ↑↓ scroll · esc close', style: { color: 'muted' } })]),
  ]);
  return Modal(card);
}

// ── In-match model swap ─────────────────────────────────────────────────────────
// A single reusable side for the click-a-wisp popup: the same provider→model
// picker as one column of the start modal, retargeted per open to whichever side
// was clicked and seeded with that side's current model. Distinct dropdown ids
// (`setup-swap-*`) keep it from colliding with the two start-modal sides.
const swap = makeSide('white', 'setup-swap', 'anthropic', 'anthropic/claude-haiku-4.5');

export function mountSwapSetup(ui: Screen): void {
  ui.mount(swap.providerDropdown);
  ui.mount(swap.modelDropdown);
}

// Retarget the swap popup to a side and seed it with the side's current model.
// Committing the provider (via its dropdown, so the field + model list update)
// then the model reproduces the exact state a manual pick would leave — with the
// current model pre-selected, so Switch is enabled immediately. `swap.provider`
// is cleared first so re-picking the same provider still repopulates the list.
export function openSwapSetup(color: 'white' | 'black', slug: string): void {
  swap.key = color;
  const provider = slug.split('/')[0] ?? slug;
  swap.provider = null;
  swap.providerDropdown.pick(providerIndex(provider)); // onSelect → pickProvider populates swap.models
  const i = swap.models.findIndex((m) => m.id === slug);
  if (i >= 0) swap.modelDropdown.pick(i);
}

// The swap popup's chosen model slug, or null when no model is committed yet.
export function swapSetupSelection(): string | null {
  return swap.modelId;
}

// The one-column swap modal: the clicked side's provider→model picker with
// Switch (enabled once a model is committed) and Cancel. `title` is the side
// label ("White"/"Black"); the column tints it via swap.key.
export function buildSwapSetup(_region: LayoutBox, opts: { title: string; onConfirm: () => void; onCancel: () => void }): Node {
  const ready = swap.modelId !== null;
  const confirm = Button({ id: 'swap-confirm', label: 'switch', onClick: ready ? opts.onConfirm : undefined, style: ready ? START_ON : START_OFF });
  const cancel = Button({ id: 'swap-cancel', label: 'cancel', onClick: opts.onCancel, style: CANCEL });
  const card = Box({ flexDirection: 'column', gap: 1, padding: [1, 3], background: [22, 24, 32] }, [
    Box({ justifyContent: 'center' }, [Text({ text: 'switch model', style: { color: [222, 224, 234], bold: true } })]),
    Box({ flexDirection: 'row', justifyContent: 'center' }, [column(swap, opts.title)]),
    Box({ flexDirection: 'row', justifyContent: 'center', gap: 2 }, [confirm, cancel]),
    Box({ justifyContent: 'center' }, [Text({ text: 'tab move · enter open/pick · ↑↓ scroll · esc close', style: { color: 'muted' } })]),
  ]);
  return Modal(card);
}
