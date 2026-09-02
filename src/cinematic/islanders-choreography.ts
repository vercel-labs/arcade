import type { IslandersAction, PlayerColor } from '../rules/islanders/types.ts';
import { ISLANDERS_BOARD_BUILD_END, ISLANDERS_COAST_DURATION, ISLANDERS_COAST_START, ISLANDERS_HARBOR_DURATION, ISLANDERS_HARBOR_START, ISLANDERS_HARBOR_STEP, islandersCoastProgress, islandersHarborProgress, islandersTilePlacementProgress } from '../game-visuals/islanders/setup-choreography.ts';

export const ISLANDERS_SETUP_COAST_START = ISLANDERS_COAST_START;
export const ISLANDERS_SETUP_COAST_DURATION = ISLANDERS_COAST_DURATION;
export const ISLANDERS_SETUP_HARBOR_START = ISLANDERS_HARBOR_START;
export const ISLANDERS_SETUP_HARBOR_STEP = ISLANDERS_HARBOR_STEP;
export const ISLANDERS_SETUP_HARBOR_DURATION = ISLANDERS_HARBOR_DURATION;
export const ISLANDERS_SETUP_END = ISLANDERS_BOARD_BUILD_END;
export const ISLANDERS_GAMEPLAY_START = ISLANDERS_SETUP_END + 0.35;
export const ISLANDERS_CINEMATIC_LOOP_SECONDS = 18;
/** A quiet, fully assembled frame for visitors who opt out of motion. */
export const ISLANDERS_REDUCED_MOTION_TIME = ISLANDERS_GAMEPLAY_START + 30;

export interface IslandersPlacementBeat {
  seat: number;
  color: PlayerColor;
  action: Extract<IslandersAction, { type: 'initialSettlement' | 'initialRoad' | 'buildSettlement' | 'buildRoad' | 'buildCity' }>;
  at: number;
  progress: number;
}

export interface IslandersDiceBeat {
  values: readonly [number, number];
  sum: number;
  settledSum: number | null;
  elapsed: number;
  rolling: boolean;
  burn: number;
}

export interface IslandersRobberBeat { from: number; to: number; progress: number }
export interface IslandersGameplaySample {
  setupElapsed: number;
  placements: readonly IslandersPlacementBeat[];
  dice: IslandersDiceBeat | null;
  robber: IslandersRobberBeat | null;
}

const COLORS: readonly PlayerColor[] = ['red', 'blue', 'purple', 'orange'];
const rawPlacements: readonly { seat: number; action: IslandersPlacementBeat['action'] }[] = [
  { seat: 0, action: { type: 'initialSettlement', node: 19 } },
  { seat: 0, action: { type: 'initialRoad', edge: 21 } },
  { seat: 1, action: { type: 'initialSettlement', node: 22 } },
  { seat: 1, action: { type: 'initialRoad', edge: 27 } },
  { seat: 2, action: { type: 'initialSettlement', node: 17 } },
  { seat: 2, action: { type: 'initialRoad', edge: 16 } },
  { seat: 3, action: { type: 'initialSettlement', node: 25 } },
  { seat: 3, action: { type: 'initialRoad', edge: 31 } },
  { seat: 3, action: { type: 'initialSettlement', node: 23 } },
  { seat: 3, action: { type: 'initialRoad', edge: 29 } },
  { seat: 2, action: { type: 'initialSettlement', node: 27 } },
  { seat: 2, action: { type: 'initialRoad', edge: 33 } },
  { seat: 1, action: { type: 'initialSettlement', node: 29 } },
  { seat: 1, action: { type: 'initialRoad', edge: 36 } },
  { seat: 0, action: { type: 'initialSettlement', node: 16 } },
  { seat: 0, action: { type: 'initialRoad', edge: 18 } },
];

export const ISLANDERS_CINEMATIC_PLACEMENTS = rawPlacements.map((beat, index) => ({
  ...beat,
  color: COLORS[beat.seat],
  at: ISLANDERS_GAMEPLAY_START + index * 0.58,
  progress: 1,
}));

const DEVELOPMENT_START = ISLANDERS_CINEMATIC_PLACEMENTS.at(-1)!.at + 0.95;
const DEVELOPMENT_STEP = 0.85;
const rawDevelopments: readonly { seat: number; action: IslandersPlacementBeat['action'] }[] = [
  { seat: 0, action: { type: 'buildRoad', edge: 17 } },
  { seat: 1, action: { type: 'buildRoad', edge: 28 } },
  { seat: 2, action: { type: 'buildRoad', edge: 20 } },
  { seat: 3, action: { type: 'buildRoad', edge: 11 } },
  { seat: 0, action: { type: 'buildRoad', edge: 19 } },
  { seat: 1, action: { type: 'buildRoad', edge: 24 } },
  { seat: 2, action: { type: 'buildRoad', edge: 0 } },
  { seat: 3, action: { type: 'buildRoad', edge: 15 } },
  { seat: 2, action: { type: 'buildSettlement', node: 5 } },
  { seat: 3, action: { type: 'buildSettlement', node: 12 } },
  { seat: 0, action: { type: 'buildRoad', edge: 2 } },
  { seat: 1, action: { type: 'buildRoad', edge: 26 } },
  { seat: 0, action: { type: 'buildSettlement', node: 2 } },
  { seat: 1, action: { type: 'buildSettlement', node: 10 } },
  { seat: 2, action: { type: 'buildCity', node: 17 } },
  { seat: 3, action: { type: 'buildCity', node: 25 } },
  { seat: 0, action: { type: 'buildCity', node: 19 } },
  { seat: 1, action: { type: 'buildCity', node: 22 } },
];

/** Slower post-setup development, spatially valid but intentionally independent of resource timing. */
export const ISLANDERS_CINEMATIC_DEVELOPMENTS = rawDevelopments.map((beat, index) => ({
  ...beat,
  color: COLORS[beat.seat],
  at: DEVELOPMENT_START + index * DEVELOPMENT_STEP,
  progress: 1,
}));

const ROLLS = [
  { at: 1.1, values: [4, 5] as const },
  { at: 5.2, values: [3, 4] as const },
  { at: 10.4, values: [2, 6] as const },
] as const;
const DICE_ROLL = 2.05;
const DICE_HOLD = 1.25;
const DICE_BURN = 0.8;
const ROBBER_TO_HEX = 6;

export function islandersCinematicGameplay(elapsedSeconds: number): IslandersGameplaySample {
  const elapsed = Math.max(0, Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0);
  const gameplayElapsed = Math.max(0, elapsed - ISLANDERS_GAMEPLAY_START);
  const gameplay = gameplayElapsed % ISLANDERS_CINEMATIC_LOOP_SECONDS;
  const iteration = Math.floor(gameplayElapsed / ISLANDERS_CINEMATIC_LOOP_SECONDS);
  const placements = [...ISLANDERS_CINEMATIC_PLACEMENTS, ...ISLANDERS_CINEMATIC_DEVELOPMENTS].flatMap((beat) => {
    const progress = smoothstep(clamp01((elapsed - beat.at) / 0.45));
    return progress <= 0 ? [] : [{ ...beat, progress }];
  });
  let dice: IslandersDiceBeat | null = null;
  for (const roll of ROLLS) {
    const age = gameplay - roll.at;
    if (age < 0 || age >= DICE_ROLL + DICE_HOLD + DICE_BURN) continue;
    const burn = clamp01((age - DICE_ROLL - DICE_HOLD) / DICE_BURN);
    const sum = roll.values[0] + roll.values[1];
    dice = { values: roll.values, sum, settledSum: age < DICE_ROLL ? null : sum, elapsed: Math.min(age, DICE_ROLL + 0.4), rolling: age < DICE_ROLL, burn };
  }
  const robberStart = ROLLS[1].at + DICE_ROLL + 0.35;
  const robberAge = gameplay - robberStart;
  const even = iteration % 2 === 0;
  const robberFrom = even ? -1 : ROBBER_TO_HEX;
  const robberTo = even ? ROBBER_TO_HEX : -1;
  const robber = robberAge >= 0 && robberAge < 0.9
    ? { from: robberFrom, to: robberTo, progress: clamp01(robberAge / 0.9) }
    : robberAge >= 0.9
      ? { from: robberTo, to: robberTo, progress: 1 }
      : iteration === 0
        ? null
        : { from: robberFrom, to: robberFrom, progress: 1 };
  return { setupElapsed: elapsed, placements, dice, robber };
}

export function islandersSetupTileProgress(elapsed: number, index: number): number {
  return islandersTilePlacementProgress(elapsed, index);
}

export function islandersSetupCoastProgress(elapsed: number): number {
  return smoothstep(islandersCoastProgress(elapsed));
}

export function islandersSetupHarborProgress(elapsed: number, index: number): number {
  return smoothstep(islandersHarborProgress(elapsed, index));
}

export function islandersDropProgress(elapsed: number, start: number, duration = 0.45): number {
  return smoothstep(clamp01((elapsed - start) / duration));
}

function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
function smoothstep(value: number): number { return value * value * (3 - 2 * value); }
