// The Catan match setup: an in-scene settings panel down the top-left of the board view
// (no modal, no scrim — the island stays visible behind it), the same shape poker uses.
// Choose the mode (you play vs. spectate), the seat count (2..4), your piece color, and a
// creator → model per AI seat. Every choice is pre-committed to a sensible default so the
// "start game" button is live immediately. State lives on module-level instances so it
// survives the per-frame rebuild (mounted via Slot).
//
// Colors are picked once, for you: the remaining seats take the rest of PLAYER_COLORS in
// order, so two seats can never share a color and no per-seat color control is needed.

import { Box, Button, Dropdown, Slot, Text, type Node, type Screen } from '../../tui/index.ts';
import type { RGB } from '../../engine/index.ts';
import { pickerCreators, type ModelInfo } from './models.ts';
import { SLOW_MODELS } from './beta-allowlist.ts';
import { creatorTint } from '../scenes/wisp.ts';
import { shortModel } from '../games/chess/hud.ts';
import { PLAYER_LOOK } from '../games/catan/card-hud.ts';
import { PLAYER_COLORS, type PlayerColor } from '../../rules/catan/types.ts';
import type { CatanSeatSpec } from './catan-driver.ts';

interface AiCreator {
  slug: string;
  name: string;
  models: ModelInfo[];
}

const TEXT_CREATORS: AiCreator[] = pickerCreators();
const LIST_ROWS = 7; // visible rows when a dropdown is open (lists scroll past this)
const CREATOR_W = 22;
const MODEL_W = 22;
const MAX_SEATS = 4; // the base game's ceiling; the rules engine allows 2 for heads-up
const MIN_SEATS = 2;
const SEAT_LABEL_W = 10; // wide enough for "your color"; keeps every control aligned

// Fires on every committed change, so main can refresh the live board preview (the seat
// colors). Null until main wires it — module init commits the defaults before the hook
// exists, and there is nothing to preview yet.
let onChanged: (() => void) | null = null;
export function setCatanSetupChanged(fn: () => void): void {
  onChanged = fn;
}
const changed = (): void => {
  onChanged?.();
};

interface AiSide {
  readonly creators: readonly AiCreator[];
  readonly creatorDropdown: Dropdown;
  readonly modelDropdown: Dropdown;
  readonly randomId: string;
  creator: string | null;
  models: ModelInfo[];
  modelId: string | null;
}

function creatorIndex(creators: readonly AiCreator[], slug: string): number {
  const i = creators.findIndex((c) => c.slug === slug);
  return i < 0 ? 0 : i;
}

function pickCreator(side: AiSide, slug: string): void {
  if (side.creator === slug) return;
  side.creator = slug;
  side.models = side.creators.find((creator) => creator.slug === slug)?.models ?? [];
  side.modelDropdown.setItems(side.models.map((m) => m.name));
  side.modelId = null;
}

// Drop a random creator+model combo into a seat, driving the seat's own dropdowns via
// pick() so the field, model list, and preview update exactly as a manual pick would.
// Prefers a combo different from the current one so a click always feels like it did
// something; every offered combo is pre-validated by pickerCreators().
function randomizeSide(side: AiSide): void {
  const creators = side.creators;
  if (creators.length === 0) return;
  const prev = side.modelId;
  for (let attempt = 0; attempt < 8; attempt++) {
    const c = creators[(Math.random() * creators.length) | 0];
    if (c.models.length === 0) continue;
    const m = c.models[(Math.random() * c.models.length) | 0];
    if (m.id === prev && attempt < 7) continue;
    side.creator = null;
    side.creatorDropdown.pick(creatorIndex(creators, c.slug));
    const i = side.models.findIndex((mm) => mm.id === m.id);
    if (i >= 0) side.modelDropdown.pick(i);
    return;
  }
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

// One config per AI seat the table can hold. Index 0 is only used when spectating (where
// seat 1 is a model too); playing, you are seat 1 and indices 1.. are your opponents.
// Spanning four creators keeps the default 4-seat spectate table from repeating one.
const DEFAULT_MODELS = [
  ['xai', 'xai/grok-4.1-fast-non-reasoning'],
  ['anthropic', 'anthropic/claude-haiku-4.5'],
  ['openai', 'openai/gpt-5.4-nano'],
  ['google', 'google/gemini-2.5-flash'],
] as const;
const sides: AiSide[] = DEFAULT_MODELS.map(([prov, model], i) => makeSide(`catan-seat${i}`, TEXT_CREATORS, prov, model));

// How many players sit at the board, you included when playing: 2..4. Defaults to 3, the
// smallest count the physical base game ships for.
export const seatsDropdown = new Dropdown({
  id: 'catan-seats',
  items: Array.from({ length: MAX_SEATS - MIN_SEATS + 1 }, (_, i) => String(i + MIN_SEATS)),
  width: 6,
  index: 1,
  onSelect: () => changed(),
});
function seatCount(): number {
  return (seatsDropdown.index < 0 ? 0 : seatsDropdown.index) + MIN_SEATS;
}

// Your piece color. The other seats take the remaining colors in PLAYER_COLORS order, so
// the set is always distinct without a control per seat.
export const colorDropdown = new Dropdown({
  id: 'catan-setup-color',
  items: PLAYER_COLORS.map((c) => c),
  width: 10,
  index: 0,
  onSelect: () => changed(),
});
function heroColor(): PlayerColor {
  return PLAYER_COLORS[colorDropdown.index < 0 ? 0 : colorDropdown.index];
}

// Play (you are seat 1) vs. Spectate (every seat is a model). Drives whether seat 1 gets
// its own model row and whether the color picker applies to you or to seat 1.
export const modeDropdown = new Dropdown({
  id: 'catan-setup-mode',
  items: ['play vs ai', 'spectate ai'],
  width: 16,
  index: 0,
  onSelect: () => changed(),
});
function spectating(): boolean {
  return modeDropdown.index === 1;
}

// Seat colors in seat order: the picked color leads, the rest follow in catalog order.
export function catanSeatColors(): PlayerColor[] {
  const hero = heroColor();
  const rest = PLAYER_COLORS.filter((c) => c !== hero);
  return [hero, ...rest].slice(0, seatCount());
}

// The AI-config indices shown as rows: opponents 1..n-1 always, plus seat 1's config
// (index 0) when spectating.
function shownIndices(): number[] {
  const idx: number[] = [];
  if (spectating()) idx.push(0);
  for (let i = 1; i < seatCount(); i++) idx.push(i);
  return idx;
}

export function mountCatanSetup(ui: Screen): void {
  ui.mount(seatsDropdown);
  ui.mount(modeDropdown);
  ui.mount(colorDropdown);
  for (const s of sides) {
    ui.mount(s.creatorDropdown);
    ui.mount(s.modelDropdown);
  }
}

// Ready when every shown seat's config has a committed model.
export function catanSetupReady(): boolean {
  return shownIndices().every((i) => sides[i].modelId !== null);
}

// The chosen seats, in seat order. Playing: seat 1 is you. Spectating: every seat is an
// AI (seat 1 uses index 0's config). null if any shown config lacks a model.
export function catanSetupSelection(): CatanSeatSpec[] | null {
  if (!catanSetupReady()) return null;
  const colors = catanSeatColors();
  const seats: CatanSeatSpec[] = [
    spectating() ? { kind: 'ai', model: sides[0].modelId!, color: colors[0] } : { kind: 'human', color: colors[0] },
  ];
  for (let i = 1; i < seatCount(); i++) seats.push({ kind: 'ai', model: sides[i].modelId!, color: colors[i] });
  return seats;
}

// The current choices as display labels, in seat order — for the status rail before the
// game starts, and for the seat labels once it has.
export function catanSetupLabels(): string[] {
  const labels: string[] = [spectating() ? seatLabel(sides[0]) : 'You'];
  for (let i = 1; i < seatCount(); i++) labels.push(seatLabel(sides[i]));
  return labels;
}
function seatLabel(side: AiSide): string {
  return side.modelId ? shortModel(side.modelId) : side.creator ?? 'AI';
}

const TITLE_FG: RGB = [222, 224, 234];
const HERO_FG: RGB = [224, 226, 236];
const SLOW_FG: RGB = [210, 168, 90];
const RANDOM_HOVER_FG: RGB = [255, 255, 255];

function randomBadge(side: AiSide): Node {
  return Button({
    id: side.randomId,
    label: '↻ random',
    onClick: () => randomizeSide(side),
    style: { padding: [0, 0], color: 'muted', hover: { color: RANDOM_HOVER_FG }, focus: { color: RANDOM_HOVER_FG } },
  });
}

function slowBadge(modelId: string | null): Node[] {
  return modelId && SLOW_MODELS.has(modelId) ? [Text({ text: '(slow)', style: { color: SLOW_FG } })] : [];
}

function brandTint(side: AiSide): RGB {
  if (!side.creator) return [212, 214, 224];
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

// One seat's row: the seat number in that seat's PIECE color (not the creator's brand hue —
// on this board the color IS the player's identity), then the creator and model pickers.
function seatRow(side: AiSide, seatNo: number, color: PlayerColor): Node {
  side.creatorDropdown.setAccent(brandTint(side));
  return Box({ flexDirection: 'row', gap: 1, alignItems: 'start' }, [
    Box({ width: SEAT_LABEL_W }, [Text({ text: `seat ${seatNo}`, style: { color: PLAYER_LOOK[color], bold: true } })]),
    Slot(side.creatorDropdown.id),
    Slot(side.modelDropdown.id),
    randomBadge(side),
    ...slowBadge(side.modelId),
  ]);
}

// The top-left settings panel: title, mode / seats / color, then one row per seat. No card
// background — the rows float over the scene and only the controls carry their own pill
// fills. Configs not currently shown keep their Slots mounted (hidden in a 0×0 box) so the
// Screen doesn't unmount them. Starting is the bottom-left "start game" button, not here.
export function buildCatanSetupPanel(): Node {
  const shownIdx = shownIndices();
  const colors = catanSeatColors();
  const seatRows: Node[] = [];
  if (!spectating()) {
    seatRows.push(
      Box({ flexDirection: 'row', gap: 1, alignItems: 'start' }, [
        Box({ width: SEAT_LABEL_W }, [Text({ text: 'seat 1', style: { color: PLAYER_LOOK[colors[0]], bold: true } })]),
        Text({ text: 'you', style: { color: HERO_FG } }),
      ]),
    );
  }
  seatRows.push(...shownIdx.map((i) => seatRow(sides[i], i + 1, colors[i])));
  const visible = new Set(shownIdx);
  const hidden = sides
    .filter((_, i) => !visible.has(i))
    .map((side) => Box({ width: 0, height: 0, overflow: 'hidden' }, [Slot(side.creatorDropdown.id), Slot(side.modelDropdown.id)]));

  return Box({ flexDirection: 'column', gap: 1, alignItems: 'start' }, [
    Text({ text: 'new game', style: { color: TITLE_FG, bold: true } }),
    row('mode', Slot('catan-setup-mode')),
    row('players', Slot('catan-seats')),
    row(spectating() ? 'seat 1' : 'your color', Slot('catan-setup-color')),
    ...seatRows,
    ...hidden,
  ]);
}
