// Shared Arcade-level creator -> model picker used by chess, poker, and Islanders setup.
// It deliberately lives above tui/: creator catalogs, model slugs, wisp colors, and the
// "slow" allowlist are Arcade concepts, while Dropdown/Slot remain generic TUI pieces.

import type { RGB } from '../../engine/index.ts';
import { Box, Button, Dropdown, Slot, Text, type Node, type Screen } from '../../tui/index.ts';
import { ARCADE_OUTLINE_CONTROL } from '../theme.ts';
import { creatorTint } from '../scenes/wisp.ts';
import { SLOW_MODELS } from './beta-allowlist.ts';
import type { ModelInfo } from './models.ts';

export interface ModelCreator {
  slug: string;
  name: string;
  models: ModelInfo[];
}

export interface ModelSeatPicker {
  creators: readonly ModelCreator[];
  readonly creatorDropdown: Dropdown;
  readonly modelDropdown: Dropdown;
  readonly randomId: string;
  creator: string | null;
  models: ModelInfo[];
  modelId: string | null;
  onChange: () => void;
}

export interface ModelSeatPickerOpts {
  idPrefix: string;
  creators: readonly ModelCreator[];
  defaultCreator: string;
  defaultModelId?: string;
  creatorWidth?: number;
  modelWidth?: number;
  rows?: number;
  onChange?: () => void;
}

const SLOW_FG: RGB = [210, 168, 90];
const RANDOM_HOVER_FG: RGB = [255, 255, 255];

function creatorIndex(creators: readonly ModelCreator[], slug: string): number {
  const i = creators.findIndex((creator) => creator.slug === slug);
  return i < 0 ? 0 : i;
}

function pickCreator(picker: ModelSeatPicker, slug: string): void {
  if (picker.creator === slug) return;
  picker.creator = slug;
  picker.models = picker.creators.find((creator) => creator.slug === slug)?.models ?? [];
  picker.modelDropdown.setItems(picker.models.map((model) => model.name));
  picker.modelId = null;
}

export function createModelSeatPicker(opts: ModelSeatPickerOpts): ModelSeatPicker {
  let picker: ModelSeatPicker;
  const creatorDropdown = new Dropdown({
    searchable: true,
    searchPlaceholder: 'Search',
    id: `${opts.idPrefix}-creator`,
    items: opts.creators.map((creator) => creator.name),
    width: opts.creatorWidth ?? 22,
    rows: opts.rows ?? 7,
    index: creatorIndex(opts.creators, opts.defaultCreator),
    onSelect: (i) => {
      pickCreator(picker, picker.creators[i].slug);
      picker.onChange();
    },
  });
  const modelDropdown = new Dropdown({
    searchable: true,
    searchPlaceholder: 'Search',
    id: `${opts.idPrefix}-model`,
    items: [],
    width: opts.modelWidth ?? 22,
    rows: opts.rows ?? 7,
    placeholder: 'pick a model…',
    onSelect: (i) => {
      picker.modelId = picker.models[i]?.id ?? null;
      picker.onChange();
    },
  });
  picker = {
    creators: opts.creators,
    creator: null,
    models: [],
    modelId: null,
    creatorDropdown,
    modelDropdown,
    randomId: `${opts.idPrefix}-random`,
    onChange: opts.onChange ?? (() => {}),
  };
  pickCreator(picker, opts.defaultCreator);
  if (opts.defaultModelId) {
    const i = picker.models.findIndex((model) => model.id === opts.defaultModelId);
    if (i >= 0) modelDropdown.pick(i);
  }
  return picker;
}

// Swap in a new catalog, keeping the current model when the catalog still has it. When it
// does not, `fallback` decides the seat: a `{ creator, model }` to select, `null` to leave
// the model unset (the creator column keeps its place, the model column shows its
// placeholder, and the panel's Start stays disabled), or undefined for the historical
// behavior of the creator's first model.
export function setModelSeatCreators(
  picker: ModelSeatPicker,
  creators: readonly ModelCreator[],
  fallback?: { creator: string; model: string } | null,
): void {
  const previousCreator = picker.creator;
  const previousModelId = picker.modelId;
  picker.creators = creators;
  if (creators.length === 0) {
    picker.creator = null;
    picker.models = [];
    picker.modelId = null;
    picker.creatorDropdown.setItems([]);
    picker.modelDropdown.setItems([]);
    return;
  }

  const has = (modelId: string | null): boolean => modelId !== null && creators.some((creator) => creator.models.some((model) => model.id === modelId));
  const keep = has(previousModelId) ? previousModelId : fallback && has(fallback.model) ? fallback.model : null;
  let creatorIndex = keep
    ? creators.findIndex((creator) => creator.models.some((model) => model.id === keep))
    : -1;
  if (creatorIndex < 0 && previousCreator) creatorIndex = creators.findIndex((creator) => creator.slug === previousCreator);
  if (creatorIndex < 0) creatorIndex = 0;

  const creator = creators[creatorIndex];
  picker.creator = creator.slug;
  picker.models = creator.models;
  const modelIndex = keep ? creator.models.findIndex((model) => model.id === keep) : -1;
  const selectedModelIndex = modelIndex >= 0
    ? modelIndex
    : fallback === undefined && creator.models.length > 0 ? 0 : -1;
  picker.modelId = selectedModelIndex >= 0 ? creator.models[selectedModelIndex].id : null;
  picker.creatorDropdown.setItems(creators.map((candidate) => candidate.name), creatorIndex);
  picker.modelDropdown.setItems(creator.models.map((model) => model.name), selectedModelIndex);
}

export function selectModelSeat(picker: ModelSeatPicker, creatorSlug: string, modelId?: string): void {
  picker.creator = null;
  picker.creatorDropdown.pick(creatorIndex(picker.creators, creatorSlug));
  if (modelId) {
    const i = picker.models.findIndex((model) => model.id === modelId);
    if (i >= 0) picker.modelDropdown.pick(i);
  }
}

export function randomizeModelSeat(picker: ModelSeatPicker): void {
  if (picker.creators.length === 0) return;
  const previous = picker.modelId;
  for (let attempt = 0; attempt < 8; attempt++) {
    const creator = picker.creators[(Math.random() * picker.creators.length) | 0];
    if (creator.models.length === 0) continue;
    const model = creator.models[(Math.random() * creator.models.length) | 0];
    if (model.id === previous && attempt < 7) continue;
    selectModelSeat(picker, creator.slug, model.id);
    return;
  }
}

export function mountModelSeat(screen: Screen, picker: ModelSeatPicker): void {
  screen.mount(picker.creatorDropdown);
  screen.mount(picker.modelDropdown);
}

export function modelSeatTint(picker: ModelSeatPicker): RGB {
  if (!picker.creator) return ARCADE_OUTLINE_CONTROL.neutralText;
  const tint = creatorTint(picker.creator);
  return [tint.x | 0, tint.y | 0, tint.z | 0];
}

export function modelSeatControls(picker: ModelSeatPicker): Node[] {
  picker.creatorDropdown.setAccent(modelSeatTint(picker));
  return [
    Slot(picker.creatorDropdown.id),
    Slot(picker.modelDropdown.id),
    Button({
      id: picker.randomId,
      label: '↻ random',
      onClick: () => randomizeModelSeat(picker),
      style: { padding: [0, 0], color: 'muted', hover: { color: RANDOM_HOVER_FG }, focus: { color: RANDOM_HOVER_FG } },
    }),
    ...modelSeatSlowBadge(picker),
  ];
}

export function modelSeatSlowBadge(picker: ModelSeatPicker): Node[] {
  return picker.modelId && SLOW_MODELS.has(picker.modelId) ? [Text({ text: '(slow)', style: { color: SLOW_FG } })] : [];
}

export function hiddenModelSeat(picker: ModelSeatPicker): Node {
  return Box({ width: 0, height: 0, overflow: 'hidden' }, [Slot(picker.creatorDropdown.id), Slot(picker.modelDropdown.id)]);
}
