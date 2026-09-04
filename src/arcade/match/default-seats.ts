// What a fresh setup panel pre-fills: a creator per AI seat, never a model. The seat opens on
// that creator's popularity-sorted list with "pick a model…" showing, so the player makes
// the one choice that matters and Start waits for it. A creator is enough to show the
// seat's wisp, so the table comes alive as soon as anyone picks.
//
// Creators are dealt to the AI seats in ranking order, skipping the human's seat rather
// than letting it swallow a rank: you at seat 1 of a four-seat table face OpenAI, Anthropic,
// and Google, the same three a spectator watches. A creator the team's catalog lacks (no
// model at all, or every model policy-blocked) is skipped and the rest shift up; a table
// with more AI seats than present creators wraps to the top of the ranking.
//
// The ranking: the four flagship labs in brand order, then every other creator by how its
// fastest fully-playable model did across chess, poker, and Islanders in the headless
// benchmark (docs/model-bench.vercel-internal-playground.md): worst-game median latency
// first, the creator's median over all its models as the tiebreak. Meta is last because
// its models reject structured output and fall to random moves. Creators the benchmark
// never saw come after the ranked ones, alphabetically.
import type { ModelCreator } from './model-seat-picker.ts';

export const DEFAULT_CREATOR_RANKING: readonly string[] = [
  'openai',
  'anthropic',
  'google',
  'spacexai',
  'zai', // glm-5.2-fast 4.3 s worst-game median; 3 of 7 models fast
  'amazon', // nova-lite 1.4 s; all 4 models fast, all small
  'alibaba', // qwen-3-32b 3.0 s; 6 of 9 models playable
  'nvidia', // nemotron-nano 2.5 s median but a 600 s Islanders tail
  'deepseek', // deepseek-v4-flash 10.4 s; provider outages seen
  'moonshotai', // kimi-k2.5 4.0 s, but the creator's median is 35 s
  'minimax', // minimax-m2.1 8.3 s; the free tier evaluates eligible yet does not route
  'meta', // no fully playable model
];

// Chess seats White before Black, and Anthropic takes White: playing White (the default)
// you face OpenAI, playing Black you face Claude, and a spectated game is Claude vs GPT.
export const CHESS_CREATOR_RANKING: readonly string[] = ['anthropic', 'openai', ...DEFAULT_CREATOR_RANKING.filter((slug) => slug !== 'anthropic' && slug !== 'openai')];

// The creators this catalog can seat, in ranking order, unranked ones last.
export function rankedCreators(creators: readonly ModelCreator[], ranking: readonly string[] = DEFAULT_CREATOR_RANKING): string[] {
  const present = new Set(creators.filter((creator) => creator.models.length > 0).map((creator) => creator.slug));
  const ranked = ranking.filter((slug) => present.has(slug));
  const rest = [...present].filter((slug) => !ranking.includes(slug)).sort();
  return [...ranked, ...rest];
}

// Deal creators to the AI seats of a `count`-seat table, in table order. `aiSeats` are the
// seat indices a model occupies in the current mode; the others (the human) get null.
export function dealDefaultCreators(
  creators: readonly ModelCreator[],
  count: number,
  aiSeats: readonly number[] = Array.from({ length: count }, (_, seat) => seat),
  ranking: readonly string[] = DEFAULT_CREATOR_RANKING,
): (string | null)[] {
  const ranked = rankedCreators(creators, ranking);
  const seats: (string | null)[] = Array.from({ length: count }, () => null);
  aiSeats.forEach((seat, rank) => {
    if (seat >= 0 && seat < count && ranked.length) seats[seat] = ranked[rank % ranked.length];
  });
  return seats;
}

// Model ids for headless tools that have no picker (self-play, match-lab defaults): one
// fast, structured-output model per flagship creator, all benchmarked in every game.
export const DEFAULT_TOOL_MODELS: readonly string[] = [
  'openai/gpt-5.6-luna',
  'anthropic/claude-sonnet-5',
  'google/gemini-3.8-flash',
  'spacexai/grok-4.20-non-reasoning',
];

export function defaultToolModels(count: number): string[] {
  return Array.from({ length: count }, (_, seat) => DEFAULT_TOOL_MODELS[seat % DEFAULT_TOOL_MODELS.length]);
}
