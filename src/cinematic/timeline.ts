// Scroll distance is cinematic time: 3s Prism, 5s Cover Flow, 9s Chess,
// 11s Poker, and 10s Islanders in the constant-speed 38s tour. Poker gets the
// extra time its first hand needs to complete the flop before the outgoing cut.
// Each ink cut occupies the same 1.5 / 38 of total scroll, so manual and
// automatic pacing share one timeline.
export const LIVING_TITLE_ACT_BOUNDARIES = [0, 3 / 38, 8 / 38, 17 / 38, 28 / 38, 1] as const;
const INK_SCROLL_DISTANCE = 1.5 / 38;
export const LIVING_TITLE_MORPH_STARTS = [
  1 - INK_SCROLL_DISTANCE / (3 / 38),
  1 - INK_SCROLL_DISTANCE / (5 / 38),
  1 - INK_SCROLL_DISTANCE / (9 / 38),
  1 - INK_SCROLL_DISTANCE / (11 / 38),
] as const;

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
