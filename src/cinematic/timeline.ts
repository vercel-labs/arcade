// Scroll distance is cinematic time. Chess and Poker receive the largest
// chapters so their gameplay and camera studies remain legible at a natural
// wheel/trackpad pace; transitions occupy the tail of each chapter.
export const LIVING_TITLE_ACT_BOUNDARIES = [0, 0.1, 0.25, 0.52, 0.76, 1] as const;
export const LIVING_TITLE_MORPH_STARTS = [0.6, 0.82, 0.85, 0.85] as const;

export type LivingTitleAct = 'prism' | 'covers' | 'chess' | 'poker' | 'islanders';
export const LIVING_TITLE_ACTS: readonly LivingTitleAct[] = ['prism', 'covers', 'chess', 'poker', 'islanders'];

export function livingTitleTimeline(progress: number): { act: number; local: number } {
  const p = clamp01(progress);
  let act = LIVING_TITLE_ACTS.length - 1;
  for (let index = 0; index < LIVING_TITLE_ACTS.length; index++) {
    if (p < LIVING_TITLE_ACT_BOUNDARIES[index + 1]) { act = index; break; }
  }
  const start = LIVING_TITLE_ACT_BOUNDARIES[act];
  const end = LIVING_TITLE_ACT_BOUNDARIES[act + 1];
  return { act, local: p >= 1 ? 1 : (p - start) / (end - start) };
}

function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
