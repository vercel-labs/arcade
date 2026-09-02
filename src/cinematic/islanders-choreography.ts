import type { PlayerColor } from '../rules/islanders/types.ts';

export interface IslandersBuildingBeat { node: number; color: PlayerColor; start: number; cityAt?: number }
export interface IslandersRoadBeat { edge: number; color: PlayerColor; start: number }

/** Deliberately scattered production-piece beats around the three terrain studies. */
export const ISLANDERS_BUILDING_BEATS: readonly IslandersBuildingBeat[] = [
  { node: 20, color: 'red', start: 0.27, cityAt: 0.57 },
  { node: 33, color: 'blue', start: 0.37 },
  { node: 42, color: 'purple', start: 0.46 },
  // The seeded board's only legal ore/brick boundary relative to the other
  // three settlements. Node 21 was adjacent to red node 20.
  { node: 22, color: 'orange', start: 0.54 },
];

export const ISLANDERS_ROAD_BEATS: readonly IslandersRoadBeat[] = [
  { edge: 41, color: 'red', start: 0.31 },
  { edge: 43, color: 'blue', start: 0.41 },
  { edge: 55, color: 'purple', start: 0.5 },
  { edge: 28, color: 'orange', start: 0.58 },
  // A second wave visibly contests routes around the triad.
  { edge: 39, color: 'red', start: 0.6 },
  { edge: 58, color: 'blue', start: 0.62 },
];

export function islandersDropProgress(progress: number, start: number, duration = 0.045): number {
  const t = Math.max(0, Math.min(1, (progress - start) / duration));
  return t * t * (3 - 2 * t);
}
