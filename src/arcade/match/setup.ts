// The AI match setup modal: pick a creator → model for White and for Black, then
// Start. Each side is two collapsing Dropdowns (creator above model) over the
// baked Gateway catalog (models.ts) — closed, they show just the current choice,
// so the modal stays compact instead of spilling two long lists per side. The
// dropdown state lives on module-level instances + `Side` records so it survives
// the per-frame rebuild (mounted via Slot like the move panel). Start is enabled
// only once BOTH sides have a model committed; picking a different creator clears
// that side's model (re-picking the same creator, or a different model under it,
// leaves the creator intact).
import { Box, Button, Dialog, Dropdown, Modal, RoundedButton, Slot, Text, type LayoutBox, type Node, type Screen } from '../../tui/index.ts';
import type { RGB } from '../../engine/index.ts';
import { includeEarlyAccessModels, pickerCreators, type ModelInfo } from './models.ts';
import { availableRealtimeModels } from '../../voice/index.ts';
import { SLOW_MODELS } from './beta-allowlist.ts';
import { creatorTint } from '../scenes/wisp.ts';
import type { Seat } from './driver.ts';
import { UI_CHROME_BG } from '../theme.ts';

interface PickerCreator {
  slug: string;
  name: string;
  models: ModelInfo[];
}

const TEXT_CREATORS: PickerCreator[] = pickerCreators();
const REALTIME_CREATORS: PickerCreator[] = [];
for (const model of availableRealtimeModels(includeEarlyAccessModels())) {
  let creator = REALTIME_CREATORS.find((candidate) => candidate.slug === model.creator);
  if (!creator) {
    creator = { slug: model.creator, name: model.creatorName, models: [] };
    REALTIME_CREATORS.push(creator);
  }
  creator.models.push({ id: model.id, name: model.name });
}
const LIST_ROWS = 7; // visible rows when a dropdown is open (lists scroll past this)
const CREATOR_W = 22;
const MODEL_W = 26;
const SIDE_LABEL_W = 8; // the "white"/"black" gutter, so the side rows line up (mirrors poker-setup)

interface Side {
  creators: readonly PickerCreator[];
  key: 'white' | 'black'; // drives the title tint; mutable so the swap side can be reused for either color
  readonly creatorDropdown: Dropdown;
  readonly modelDropdown: Dropdown;
  readonly randomId: string; // the side's "↻ random" affordance id
  creator: string | null;
  models: ModelInfo[];
  modelId: string | null;
  human: boolean; // this side is a human at the keyboard (hides the creator/model pickers)
}

function creatorIndex(creators: readonly PickerCreator[], slug: string): number {
  const i = creators.findIndex((c) => c.slug === slug);
  return i < 0 ? 0 : i;
}

// Drop a random creator+model combo into a side. Drives the side's own dropdowns
// via pick() (clearing `creator` first so an unchanged creator still repopulates),
// so pickCreator + the model handler run and the field + model list update exactly
// as a manual pick would. Prefers a combo different from the current one (bounded
// retries) so a click always feels like it did something; every offered combo is
// pre-validated by pickerCreators().
function randomizeSide(side: Side): void {
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

// Set a side's creator: repopulate its model list and clear the committed model.
// A no-op when the creator is unchanged, so re-picking it (or moving within its
// models) doesn't wipe the selection.
function pickCreator(side: Side, slug: string): void {
  if (side.creator === slug) return;
  side.creator = slug;
  side.models = side.creators.find((creator) => creator.slug === slug)?.models ?? [];
  side.modelDropdown.setItems(side.models.map((m) => m.name)); // resets model → none
  side.modelId = null;
}

// `idPrefix` namespaces the two dropdown ids so several modals' sides can be
// mounted without colliding in the Screen registry (the two start-modal sides +
// the reusable swap side).
function makeSide(
  key: 'white' | 'black',
  idPrefix: string,
  defaultCreator: string,
  defaultModelId?: string,
  creators: readonly PickerCreator[] = TEXT_CREATORS,
): Side {
  // onSelect closures reference `side`, assigned just below — they only fire on
  // later user interaction, so the forward reference is safe.
  let side: Side;
  const creatorDropdown = new Dropdown({
    searchable: true,
    searchPlaceholder: 'Search',
    id: `${idPrefix}-creator`,
    items: creators.map((creator) => creator.name),
    width: CREATOR_W,
    rows: LIST_ROWS,
    index: creatorIndex(creators, defaultCreator), // a creator is pre-chosen…
    onSelect: (i) => pickCreator(side, side.creators[i].slug),
  });
  const modelDropdown = new Dropdown({
    searchable: true,
    searchPlaceholder: 'Search',
    id: `${idPrefix}-model`,
    items: [],
    width: MODEL_W,
    rows: LIST_ROWS,
    placeholder: 'pick a model…', // …but the model must be chosen explicitly
    onSelect: (i) => {
      side.modelId = side.models[i]?.id ?? null;
    },
  });
  side = { creators, key, creator: null, models: [], modelId: null, human: false, creatorDropdown, modelDropdown, randomId: `${idPrefix}-random` };
  pickCreator(side, defaultCreator); // populate the model list (modelId stays null)
  if (defaultModelId) {
    const i = side.models.findIndex((m) => m.id === defaultModelId);
    if (i >= 0) modelDropdown.pick(i); // commit the default model → sets side.modelId
  }
  return side;
}

// TEMP (demo): pre-commit a full matchup — Claude Haiku 4.5 vs GPT 5.4 Nano — so the
// modal opens with Start already enabled. To go back to "pick a model yourself",
// drop the third arg from each makeSide call (creators stay pre-selected).
const white = makeSide('white', 'setup-white', 'anthropic', 'anthropic/claude-haiku-4.5');
const black = makeSide('black', 'setup-black', 'openai', 'openai/gpt-5.4-nano');

// The match mode folds the "am I playing, and which color?" choice into one control —
// chess's analogue to poker's Play/Spectate, plus the side dimension chess needs (White
// vs Black is a real choice, unlike a poker seat). It drives the white/black `human`
// flags: the AI side(s) show model pickers, the human side a short "you". There is no
// both-human option — human-vs-human is just free-play on the board, so a setup match
// always has ≥1 AI (which is what the bar's play/pause control assumes). "Spectate AI"
// mirrors poker's mode. Defaults to Play White (White moves first — the conventional default).
export const modeDropdown = new Dropdown({
  id: 'setup-mode',
  items: ['play white', 'play black', 'spectate ai'],
  width: 16,
  index: 0,
  onSelect: () => applyMode(),
});
function applyMode(): void {
  white.human = modeDropdown.index === 0; // Play White → you are White
  black.human = modeDropdown.index === 1; // Play Black → you are Black
  // index 2 (Spectate AI) → neither side is human
}
applyMode(); // seed the default (Play White) before the first build

export function mountMatchSetup(ui: Screen): void {
  ui.mount(modeDropdown);
  for (const s of [white, black]) {
    ui.mount(s.creatorDropdown);
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
// Rounded action colors. Green is reserved for starting a match; switching an
// in-progress model uses the app's slate-indigo action color.
const SETUP_GO: RGB = [120, 205, 142];
const SWITCH_GO: RGB = [112, 122, 188];
const SETUP_OFF: RGB = [110, 114, 126];
const SETUP_NEUTRAL: RGB = [212, 214, 224];
const SETUP_NEUTRAL_BORDER: RGB = [88, 92, 110];

// A side's brand hue (the creator's wisp color), as an RGB tuple for the field.
function brandTint(side: Side): RGB {
  if (!side.creator) return [212, 214, 224];
  const t = creatorTint(side.creator);
  return [t.x | 0, t.y | 0, t.z | 0];
}

// A dim amber "slow" hint beside a known-slow model (SLOW_MODELS) — it still
// plays, just takes a while. Node[] so it spreads into a row (empty when fast).
const SLOW_FG: RGB = [210, 168, 90];
function slowBadge(modelId: string | null): Node[] {
  return modelId && SLOW_MODELS.has(modelId)
    ? [Text({ text: '(slow)', style: { color: SLOW_FG } })]
    : [];
}

// A muted "↻ random" affordance beside a side's model picker — one click rerolls
// the side to a random creator+model. Rests at 'muted' grey and brightens to white
// on hover/focus (the dialog-affordance convention); no tooltip needed since the
// label says what it does.
const RANDOM_HOVER_FG: RGB = [255, 255, 255];
function randomBadge(side: Side): Node {
  return Button({
    id: side.randomId,
    label: '↻ random',
    onClick: () => randomizeSide(side),
    style: { padding: [0, 0], color: 'muted', hover: { color: RANDOM_HOVER_FG }, focus: { color: RANDOM_HOVER_FG } },
  });
}

// One side's column for the swap popup: the centered title, then the creator/model
// pickers. Tints the creator field in the creator's brand hue (its in-game wisp color),
// set fresh each frame since the creator can change.
function column(side: Side, title: string): Node {
  side.creatorDropdown.setAccent(brandTint(side));
  return Box({ flexDirection: 'column', gap: 0, width: MODEL_W }, [
    Box({ justifyContent: 'center' }, [Text({ text: title, style: { color: TITLE_TINT[side.key], bold: true } })]),
    Box({ height: 0 }), // a blank line above the body
    Text({ text: 'creator', style: { color: 'muted' } }),
    Slot(side.creatorDropdown.id),
    Text({ text: 'model', style: { color: 'muted' } }),
    Slot(side.modelDropdown.id),
    ...slowBadge(side.modelId),
  ]);
}

// A settings row, poker-setup style: a fixed-width label gutter (tinted+bold for the side
// rows, muted for a plain label like "mode") + its control(s), so the rows line up.
// `alignItems:'start'` lets an open dropdown grow down without stretching the row.
function row(label: string, tint: RGB | 'muted', controls: Node[]): Node {
  return Box({ flexDirection: 'row', gap: 1, alignItems: 'start' }, [
    Box({ width: SIDE_LABEL_W }, [Text({ text: label, style: { color: tint, bold: tint !== 'muted' } })]),
    ...controls,
  ]);
}

// One side's row: the tinted "white"/"black" gutter + the creator/model pickers (AI), or a
// short "you" when the mode makes this side the human. When human the picker Slots stay
// mounted (hidden, 0×0 clipped) so switching the mode back to AI finds them — else the
// pickers would come back empty.
function sideRow(side: Side): Node {
  side.creatorDropdown.setAccent(brandTint(side));
  const controls: Node[] = side.human
    ? [
        Text({ text: 'you', style: { color: 'muted' } }),
        Box({ width: 0, height: 0, overflow: 'hidden' }, [Slot(side.creatorDropdown.id), Slot(side.modelDropdown.id)]),
      ]
    : [Slot(side.creatorDropdown.id), Slot(side.modelDropdown.id), randomBadge(side), ...slowBadge(side.modelId)];
  return row(side.key, TITLE_TINT[side.key], controls);
}

// The new-match setup: a top-left settings panel floating over the board (no modal, no
// scrim — the board stays visible behind, like the poker setup over the felt), with the
// start/cancel controls bottom-left. `onStart` is wired only when both sides are ready.
export function buildMatchSetup(region: LayoutBox, opts: { onStart: () => void; onCancel: () => void }): Node {
  const ready = matchSetupReady();
  // Rounded (outlined) controls over the board: a green "start" (dim + inert until both
  // sides are ready) beside a neutral "cancel". Green matches poker's new-match button.
  const start = ready
    ? RoundedButton({ id: 'setup-start', label: 'start', onClick: opts.onStart, color: SETUP_GO })
    : RoundedButton({ id: 'setup-start', label: 'start', color: SETUP_OFF });
  const cancel = RoundedButton({ id: 'setup-cancel', label: 'cancel', onClick: opts.onCancel, color: SETUP_NEUTRAL, borderColor: SETUP_NEUTRAL_BORDER });

  const panel = Box({ flexDirection: 'column', gap: 1, alignItems: 'start' }, [
    Text({ text: 'new match', style: { color: [222, 224, 234], bold: true } }),
    row('mode', 'muted', [Slot('setup-mode')]),
    sideRow(white),
    sideRow(black),
  ]);

  // Full region: panel top-left, start/cancel bottom-left (mirrors the poker HUD layout).
  return Box({ width: region.w, height: region.h, flexDirection: 'column' }, [
    Box({ flexDirection: 'row', justifyContent: 'start', padding: [1, 2] }, [panel]),
    Box({ flexGrow: 1 }),
    Box({ flexDirection: 'row', justifyContent: 'start', gap: 2, padding: [0, 0, 1, 2] }, [start, cancel]),
  ]);
}

// ── In-match model swap ─────────────────────────────────────────────────────────
// A single reusable side for the click-a-wisp popup: the same creator→model
// picker as one column of the start modal, retargeted per open to whichever side
// was clicked and seeded with that side's current model. Distinct dropdown ids
// (`setup-swap-*`) keep it from colliding with the two start-modal sides.
const swap = makeSide('white', 'setup-swap', 'anthropic', 'anthropic/claude-haiku-4.5');

export function mountSwapSetup(ui: Screen): void {
  ui.mount(swap.creatorDropdown);
  ui.mount(swap.modelDropdown);
}

// Retarget the swap popup to a side and seed it with the side's current model.
// Committing the creator (via its dropdown, so the field + model list update)
// then the model reproduces the exact state a manual pick would leave — with the
// current model pre-selected, so Switch is enabled immediately. `swap.creator`
// is cleared first so re-picking the same creator still repopulates the list.
export function openSwapSetup(
  color: 'white' | 'black',
  slug: string,
  runtime: 'text' | 'realtime' = 'text',
): void {
  const creators = runtime === 'realtime' ? REALTIME_CREATORS : TEXT_CREATORS;
  swap.creators = creators;
  swap.creatorDropdown.setItems(creators.map((creator) => creator.name));
  swap.key = color;
  const creator = slug.split('/')[0] ?? slug;
  swap.creator = null;
  swap.creatorDropdown.pick(creatorIndex(creators, creator)); // onSelect → pickCreator populates swap.models
  const i = swap.models.findIndex((m) => m.id === slug);
  if (i >= 0) swap.modelDropdown.pick(i);
}

// The swap popup's chosen model slug, or null when no model is committed yet.
export function swapSetupSelection(): string | null {
  return swap.modelId;
}

// The one-column swap modal: the clicked side's creator→model picker with
// Switch (enabled once a model is committed) and Cancel. `title` is the side
// label ("White"/"Black"); the column tints it via swap.key.
export function buildSwapSetup(_region: LayoutBox, opts: { title: string; onConfirm: () => void; onCancel: () => void }): Node {
  const ready = swap.modelId !== null;
  const confirm = ready
    ? RoundedButton({ id: 'swap-confirm', label: 'switch', onClick: opts.onConfirm, color: SWITCH_GO })
    : RoundedButton({ id: 'swap-confirm', label: 'switch', color: SETUP_OFF });
  const cancel = RoundedButton({ id: 'swap-cancel', label: 'cancel', onClick: opts.onCancel, color: SETUP_NEUTRAL, borderColor: SETUP_NEUTRAL_BORDER });
  const card = Dialog(
    {
      title: 'switch model',
      onClose: opts.onCancel,
      closeId: 'swap-close',
      align: 'center',
      padding: [1, 3],
      background: UI_CHROME_BG,
    },
    [
      Box({ flexDirection: 'row', justifyContent: 'center' }, [column(swap, opts.title)]),
      Box({ flexDirection: 'row', justifyContent: 'center', gap: 2 }, [confirm, cancel]),
    ],
  );
  return Modal(card, { onDismiss: opts.onCancel });
}
