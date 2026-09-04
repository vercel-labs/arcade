// What a fresh setup panel pre-fills: a creator per seat, never a model. The seat opens on
// that creator's popularity-sorted list with "pick a model…" showing, so the player makes
// the one choice that matters and Start waits for it. A creator is enough to show the
// seat's wisp, so the table comes alive as soon as anyone picks.
//
// The cycle is OpenAI, Anthropic, Google, xAI, then around again, so a four-seat table
// spans four creators and a six-seat table gives OpenAI and Anthropic a second seat.
// A creator the team's catalog lacks is skipped for the next one that is present, and a
// seat cycles back to an already-used creator only once every present creator has a seat.
import type { ModelCreator } from './model-seat-picker.ts';

export const DEFAULT_CREATOR_CYCLE: readonly string[] = ['openai', 'anthropic', 'google', 'spacexai'];

export function resolveDefaultCreators(creators: readonly ModelCreator[], count: number): (string | null)[] {
  const present = new Set(creators.filter((creator) => creator.models.length > 0).map((creator) => creator.slug));
  const uses = new Map<string, number>();
  const seats: (string | null)[] = [];
  for (let seat = 0; seat < count; seat++) {
    const rotated = DEFAULT_CREATOR_CYCLE.map((_, step) => DEFAULT_CREATOR_CYCLE[(seat + step) % DEFAULT_CREATOR_CYCLE.length]).filter((slug) => present.has(slug));
    if (!rotated.length) {
      seats.push(null);
      continue;
    }
    const fewest = Math.min(...rotated.map((slug) => uses.get(slug) ?? 0));
    const pick = rotated.find((slug) => (uses.get(slug) ?? 0) === fewest)!;
    uses.set(pick, fewest + 1);
    seats.push(pick);
  }
  return seats;
}

// Model ids for headless tools that have no picker (self-play, match-lab defaults): one
// fast, structured-output model per creator in the cycle, all benchmarked in every game.
export const DEFAULT_TOOL_MODELS: readonly string[] = [
  'openai/gpt-5.6-luna',
  'anthropic/claude-sonnet-5',
  'google/gemini-3.8-flash',
  'spacexai/grok-4.20-non-reasoning',
];

export function defaultToolModels(count: number): string[] {
  return Array.from({ length: count }, (_, seat) => DEFAULT_TOOL_MODELS[seat % DEFAULT_TOOL_MODELS.length]);
}
