// The AI match setup modal: pick a creator → model for White and for Black, then
// Start. Each side is two collapsing Dropdowns (creator above model) over the
// selected team's Gateway catalog (with the baked catalog as fallback) — closed, they show just the current choice,
// so the modal stays compact instead of spilling two long lists per side. The
// dropdown state lives on module-level instances + `Side` records so it survives
// the per-frame rebuild (mounted via Slot like the move panel). Start is enabled
// only once BOTH sides have a model committed; picking a different creator clears
// that side's model (re-picking the same creator, or a different model under it,
// leaves the creator intact).
import { Box, Button, Dialog, Dropdown, Field, Modal, RoundedButton, ToggleButton, Slot, Text, type LayoutBox, type Node, type Screen } from '../../tui/index.ts';
import type { RGB } from '../../engine/index.ts';
import { includeEarlyAccessModels, pickerCreators } from './models.ts';
import { resolveDefaultCreators } from './default-seats.ts';
import { availableRealtimeModels } from '../../voice/index.ts';
import type { Seat } from './driver.ts';
import { ARCADE_OUTLINE_CONTROL, MENU_BUTTON_LABEL, UI_CHROME_BG, UI_CHROME_PILL } from '../theme.ts';
import { hudTopRight } from '../shell/hud-chrome.ts';
import { CHESS_PALETTE } from '../games/chess/palette.ts';
import { createModelSeatPicker, hiddenModelSeat, modelSeatControls, modelSeatSlowBadge, modelSeatTint, mountModelSeat, selectModelSeat, setModelSeatCreators, type ModelCreator, type ModelSeatPicker } from './model-seat-picker.ts';
import { cancelMatchButton, matchSetupHeading, matchSetupLayout, startMatchButton } from './match-setup-chrome.ts';

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
const MODEL_W = 26;
const SIDE_LABEL_W = 15; // two-cell breathing room after "illegal moves"; keeps every setup row aligned

// Fires on every committed change (mode / creator / model), so main can refresh the
// live king-wisp preview behind the panel. Null until main wires it (module init
// commits the defaults before the hook exists — nothing to preview yet).
let onChanged: (() => void) | null = null;
export function setMatchSetupChanged(fn: () => void): void {
  onChanged = fn;
}
const changed = (): void => {
  onChanged?.();
};

interface Side extends ModelSeatPicker {
  key: 'white' | 'black'; // drives the title tint; mutable so the swap side can be reused for either color
  human: boolean; // this side is a human at the keyboard (hides the creator/model pickers)
}

// `idPrefix` namespaces the two dropdown ids so several modals' sides can be
// mounted without colliding in the Screen registry (the two start-modal sides +
// the reusable swap side).
function makeSide(
  key: 'white' | 'black',
  idPrefix: string,
  defaultCreator: string,
  defaultModelId?: string,
  creators: readonly ModelCreator[] = TEXT_CREATORS,
): Side {
  return Object.assign(createModelSeatPicker({ idPrefix, creators, defaultCreator, defaultModelId, modelWidth: MODEL_W, onChange: changed }), { key, human: false }) as Side;
}

// Both sides open on a creator from the default cycle with the model left for the player
// to pick, so the king wisps show at once and Start waits for two real choices.
const chessDefaults = resolveDefaultCreators(TEXT_CREATORS, 2);
const white = makeSide('white', 'setup-white', chessDefaults[0] ?? 'openai');
const black = makeSide('black', 'setup-black', chessDefaults[1] ?? 'anthropic');

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
  onSelect: () => {
    applyMode();
    changed();
  },
});
function applyMode(): void {
  white.human = modeDropdown.index === 0; // Play White → you are White
  black.human = modeDropdown.index === 1; // Play Black → you are Black
  // index 2 (Spectate AI) → neither side is human
}
applyMode(); // seed the default (Play White) before the first build

export function mountMatchSetup(ui: Screen): void {
  ui.mount(modeDropdown);
  for (const side of [white, black]) mountModelSeat(ui, side);
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

let setupEvalBar = false;
let setupIllegalMoves = false;
export function matchSetupOptions(): { evalBar: boolean; illegalMoves: boolean } {
  return { evalBar: setupEvalBar, illegalMoves: setupIllegalMoves };
}

function booleanControl(id: string, value: boolean, onChange: (value: boolean) => void): Node {
  return ToggleButton({
    id,
    value,
    onChange: (next) => {
      onChange(next);
      changed();
    },
  });
}

// The white/black creators to preview as king wisps while the setup panel is open.
// A human side contributes no wisp (null) — the in-match convention, mirroring
// poker's human seat. The creator is pre-committed, so it's rarely null in practice.
export function chessPreviewSides(): { white: string | null; black: string | null } {
  return {
    white: white.human ? null : white.creator,
    black: black.human ? null : black.creator,
  };
}

const TITLE_TINT: Record<Side['key'], RGB> = { white: CHESS_PALETTE.lightPiece, black: CHESS_PALETTE.darkPiece };
// Switching an in-progress model uses the app's slate-indigo action color.
const SWITCH_GO: RGB = ARCADE_OUTLINE_CONTROL.activeBorder;
const SETUP_OFF: RGB = [110, 114, 126];
const SETUP_NEUTRAL: RGB = ARCADE_OUTLINE_CONTROL.neutralText;
const SETUP_NEUTRAL_BORDER: RGB = ARCADE_OUTLINE_CONTROL.neutralBorder;

// One side's column for the swap popup: the centered title, then the creator/model
// pickers. Tints the creator field in the creator's brand hue (its in-game wisp color),
// set fresh each frame since the creator can change.
function column(side: Side, title: string): Node {
  side.creatorDropdown.setAccent(modelSeatTint(side));
  return Box({ flexDirection: 'column', gap: 0, width: MODEL_W }, [
    Box({ justifyContent: 'center' }, [Text({ text: title, style: { color: TITLE_TINT[side.key], bold: true } })]),
    Box({ height: 0 }), // a blank line above the body
    Text({ text: 'creator', style: { color: 'muted' } }),
    Slot(side.creatorDropdown.id),
    Text({ text: 'model', style: { color: 'muted' } }),
    Slot(side.modelDropdown.id),
    ...modelSeatSlowBadge(side),
  ]);
}

// A settings row, poker-setup style: a fixed-width label gutter (tinted+bold for the side
// rows, muted for a plain label like "mode") + its control(s), so the rows line up.
// `alignItems:'start'` lets an open dropdown grow down without stretching the row.
function row(label: string, tint: RGB | 'muted', controls: Node[]): Node {
  return Field({ label, child: controls, direction: 'row', labelWidth: SIDE_LABEL_W, labelStyle: { color: tint, bold: tint !== 'muted' } });
}

// One side's row: the tinted "white"/"black" gutter + the creator/model pickers (AI), or a
// short "you" when the mode makes this side the human. When human the picker Slots stay
// mounted (hidden, 0×0 clipped) so switching the mode back to AI finds them — else the
// pickers would come back empty.
function sideRow(side: Side): Node {
  const controls: Node[] = side.human
    ? [
        Text({ text: 'you', style: { color: 'muted' } }),
        hiddenModelSeat(side),
      ]
    : modelSeatControls(side);
  return row(side.key, TITLE_TINT[side.key], controls);
}

// The new-match setup: a top-left settings panel floating over the board (no modal, no
// scrim — the board stays visible behind, like the poker setup over the felt), with the
// start/cancel controls bottom-left. `onStart` is wired only when both sides are ready.
export function buildMatchSetup(region: LayoutBox, opts: { onStart: () => void; onCancel: () => void; onOpenMenu?: () => void; healthStatus?: { lines: string[]; failed: boolean } }): Node {
  const ready = matchSetupReady();
  // Rounded (outlined) controls over the board: a green "start" (dim + inert until both
  // sides are ready) beside a neutral "cancel". Green matches poker's new-match button.
  // `disabled` rather than just dropping onClick: a Button is focusable by construction,
  // so without it the dead control still brightened on hover and still took Tab focus.
  const checking = opts.healthStatus?.failed === false;
  const start = startMatchButton('setup-start', ready && !checking ? opts.onStart : undefined);
  const cancel = cancelMatchButton('setup-cancel', opts.onCancel);

  const panel = Box({ flexDirection: 'column', gap: 1, alignItems: 'start' }, [
    matchSetupHeading(),
    row('mode', 'muted', [Slot('setup-mode')]),
    sideRow(white),
    sideRow(black),
    row('eval bar', 'muted', [booleanControl('setup-eval', setupEvalBar, (value) => { setupEvalBar = value; })]),
    row('illegal moves', 'muted', [booleanControl('setup-illegal', setupIllegalMoves, (value) => { setupIllegalMoves = value; })]),
    ...(opts.healthStatus ? opts.healthStatus.lines.map((text) => Text({ text, style: { color: opts.healthStatus!.failed ? 'danger' : 'muted' } })) : []),
  ]);

  // Full region: panel top-left, start/cancel bottom-left (mirrors the poker HUD layout).
  return Box({ width: region.w, height: region.h }, [
    matchSetupLayout(region, panel, [start, cancel]),
    ...(opts.onOpenMenu
      ? [hudTopRight([Button({ id: 'chess-menu', label: MENU_BUTTON_LABEL, onClick: opts.onOpenMenu, style: UI_CHROME_PILL })])]
      : []),
  ]);
}

// ── In-match model swap ─────────────────────────────────────────────────────────
// A single reusable side for the click-a-wisp popup: the same creator→model
// picker as one column of the start modal, retargeted per open to whichever side
// was clicked and seeded with that side's current model. Distinct dropdown ids
// (`setup-swap-*`) keep it from colliding with the two start-modal sides.
const swap = makeSide('white', 'setup-swap', 'anthropic', 'anthropic/claude-haiku-4.5');
let swapRuntime: 'text' | 'realtime' = 'text';

export function setMatchSetupModelCatalog(
  textCreators: readonly ModelCreator[],
  realtimeCreators: readonly ModelCreator[],
): void {
  TEXT_CREATORS = [...textCreators];
  REALTIME_CREATORS = [...realtimeCreators];
  const defaults = resolveDefaultCreators(TEXT_CREATORS, 2);
  [white, black].forEach((side, i) => setModelSeatCreators(side, TEXT_CREATORS, defaults[i]));
  setModelSeatCreators(swap, swapRuntime === 'realtime' ? REALTIME_CREATORS : TEXT_CREATORS);
  changed();
}

export function mountSwapSetup(ui: Screen): void {
  mountModelSeat(ui, swap);
}

// Retarget the swap popup to a side and seed it with the side's current model.
// Committing the creator (via its dropdown, so the field + model list update)
// then the model reproduces the exact state a manual pick would leave — with the
// current model pre-selected, so Switch is enabled immediately. `swap.creator`
// is cleared first so re-picking the same creator still repopulates the list.
// `slug` seeds the picker with the seat's current model; a seat with none (a practice bot
// being replaced by a real model) opens on the first creator with no model committed.
export function openSwapSetup(
  color: 'white' | 'black',
  slug: string | null,
  runtime: 'text' | 'realtime' = 'text',
): void {
  swapRuntime = runtime;
  const creators = runtime === 'realtime' ? REALTIME_CREATORS : TEXT_CREATORS;
  setModelSeatCreators(swap, creators);
  swap.key = color;
  if (slug) selectModelSeat(swap, slug.split('/')[0] ?? slug, slug);
  else selectModelSeat(swap, creators[0]?.slug ?? '');
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
  const confirm = RoundedButton({
    id: 'swap-confirm',
    label: 'switch',
    onClick: opts.onConfirm,
    disabled: !ready,
    color: ready ? SWITCH_GO : SETUP_OFF,
    style: ready ? undefined : { disabled: { color: SETUP_OFF, borderColor: SETUP_OFF } },
  });
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
