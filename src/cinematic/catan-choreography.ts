import type { PlayerColor } from '../rules/catan/types.ts';

export interface CatanBuildingBeat { node: number; color: PlayerColor; start: number; cityAt?: number }
export interface CatanRoadBeat { edge: number; color: PlayerColor; start: number }

/** Deliberately scattered production-piece beats around the three terrain studies. */
export const CATAN_BUILDING_BEATS: readonly CatanBuildingBeat[] = [
  { node: 20, color: 'red', start: 0.27, cityAt: 0.57 },
  { node: 33, color: 'blue', start: 0.37 },
  { node: 42, color: 'purple', start: 0.46 },
  { node: 21, color: 'orange', start: 0.54 },
];

export const CATAN_ROAD_BEATS: readonly CatanRoadBeat[] = [
  { edge: 41, color: 'red', start: 0.31 },
  { edge: 43, color: 'blue', start: 0.41 },
  { edge: 55, color: 'purple', start: 0.5 },
  { edge: 24, color: 'orange', start: 0.58 },
  // A second wave visibly contests routes around the triad.
  { edge: 39, color: 'blue', start: 0.6 },
  { edge: 58, color: 'purple', start: 0.62 },
];

export function catanDropProgress(progress: number, start: number, duration = 0.045): number {
  const t = Math.max(0, Math.min(1, (progress - start) / duration));
  return t * t * (3 - 2 * t);
}
