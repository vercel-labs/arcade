export const POKER_CHIP_POT_POSITION = { x: -1.7, z: -1.4 } as const;
export const POKER_CHIP_COLLECT_STEP = 0.42;
export const POKER_CHIP_AWARD_STEP = 0.55;
export const POKER_CHIP_AWARD_HOP = 0.72;

/** Exact production felt-plane flight used for bet collection and pot awards. */
export function pokerChipFlight(from: { x: number; z: number }, to: { x: number; z: number }, progress: number, hop = 0): { x: number; z: number; lift: number } {
  const p = smooth(progress);
  return { x: from.x + (to.x - from.x) * p, z: from.z + (to.z - from.z) * p, lift: Math.sin(p * Math.PI) * hop };
}

function smooth(value: number): number { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); }
