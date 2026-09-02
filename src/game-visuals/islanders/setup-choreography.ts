export const ISLANDERS_TILE_PLACE_STEP = 0.12;
export const ISLANDERS_TILE_PLACE_DURATION = 0.55;
export const ISLANDERS_TILE_PLACE_HOP = 1.1;
export const ISLANDERS_TILE_STACK_X = -5;
export const ISLANDERS_TILE_STACK_Z = 4.15;
export const ISLANDERS_TILE_STACK_BASE_Y = 0.1;
export const ISLANDERS_TILE_STACK_THICKNESS = 0.11;
export const ISLANDERS_TILE_COUNT = 19;
export const ISLANDERS_TILE_PLACE_END = (ISLANDERS_TILE_COUNT - 1) * ISLANDERS_TILE_PLACE_STEP + ISLANDERS_TILE_PLACE_DURATION;
export const ISLANDERS_COAST_START = ISLANDERS_TILE_PLACE_END + 0.12;
export const ISLANDERS_COAST_DURATION = 0.72;
export const ISLANDERS_COAST_END = ISLANDERS_COAST_START + ISLANDERS_COAST_DURATION;
export const ISLANDERS_HARBOR_START = ISLANDERS_COAST_END + 0.14;
export const ISLANDERS_HARBOR_STEP = 0.09;
export const ISLANDERS_HARBOR_DURATION = 0.82;
export const ISLANDERS_HARBOR_COUNT = 9;
export const ISLANDERS_BOARD_BUILD_END = ISLANDERS_HARBOR_START + (ISLANDERS_HARBOR_COUNT - 1) * ISLANDERS_HARBOR_STEP + ISLANDERS_HARBOR_DURATION;

export function islandersTilePlacementProgress(elapsed: number, index: number): number {
  return clamp01((elapsed - index * ISLANDERS_TILE_PLACE_STEP) / ISLANDERS_TILE_PLACE_DURATION);
}

export function islandersCoastProgress(elapsed: number): number {
  return clamp01((elapsed - ISLANDERS_COAST_START) / ISLANDERS_COAST_DURATION);
}

export function islandersHarborProgress(elapsed: number, index: number): number {
  return clamp01((elapsed - ISLANDERS_HARBOR_START - index * ISLANDERS_HARBOR_STEP) / ISLANDERS_HARBOR_DURATION);
}

function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
