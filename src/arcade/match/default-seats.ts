// Which models a fresh setup panel pre-seats, and how those seats survive a catalog the
// models are missing from. One ladder of creators, each with its models in preference
// order: the current flagship where the flagship answers in seconds, the fast sibling
// where it does not. Every id here has played chess, poker, and Islanders headless without
// a parse failure; a slow flagship (a reasoning Grok at minutes per Islanders turn) is
// deliberately not the first thing a new player watches.
//
// Resolution walks the ladder from a seat's own rung and takes the first model the team's
// catalog actually offers, never reusing a model, so a four-seat table spans four creators
// and a six-seat table comes back around to each creator's next model. A seat the whole
// ladder cannot fill stays unset, which keeps Start disabled until the player picks: a
// visible gap beats a silently substituted model.
import type { ModelCreator } from './model-seat-picker.ts';

export interface DefaultSeatRung {
  // Catalog slugs this rung's models may appear under. xAI renamed itself on the gateway
  // (`xai/` → `spacexai/`) and the baked catalog and live catalog can disagree, so both
  // spellings are listed and the id found in the catalog wins.
  models: readonly string[];
}

export const DEFAULT_SEAT_LADDER: readonly DefaultSeatRung[] = [
  { models: ['openai/gpt-5.6-luna', 'openai/gpt-5.6-sol', 'openai/gpt-5.4-nano'] },
  { models: ['anthropic/claude-sonnet-5', 'anthropic/claude-haiku-4.5'] },
  { models: ['google/gemini-3.8-flash', 'google/gemini-2.5-flash'] },
  {
    models: [
      'spacexai/grok-4.20-non-reasoning',
      'xai/grok-4.20-non-reasoning',
      'spacexai/grok-4.1-fast-non-reasoning',
      'xai/grok-4.1-fast-non-reasoning',
    ],
  },
];

export interface DefaultSeat {
  creator: string;
  model: string;
}

// The ladder heads, for tools that need model ids without a catalog (self-play, match-lab
// defaults). The live picker resolves against the catalog instead.
export function defaultSeatModelIds(count: number): string[] {
  return Array.from({ length: count }, (_, seat) => DEFAULT_SEAT_LADDER[seat % DEFAULT_SEAT_LADDER.length].models[0]);
}

export function resolveDefaultSeats(creators: readonly ModelCreator[], count: number): (DefaultSeat | null)[] {
  const creatorOf = new Map<string, string>();
  for (const creator of creators) for (const model of creator.models) creatorOf.set(model.id, creator.slug);
  const used = new Set<string>();
  const seats: (DefaultSeat | null)[] = [];
  for (let seat = 0; seat < count; seat++) {
    let pick: DefaultSeat | null = null;
    for (let step = 0; step < DEFAULT_SEAT_LADDER.length && !pick; step++) {
      const rung = DEFAULT_SEAT_LADDER[(seat + step) % DEFAULT_SEAT_LADDER.length];
      const model = rung.models.find((id) => creatorOf.has(id) && !used.has(id));
      if (model) pick = { creator: creatorOf.get(model)!, model };
    }
    if (pick) used.add(pick.model);
    seats.push(pick);
  }
  return seats;
}
