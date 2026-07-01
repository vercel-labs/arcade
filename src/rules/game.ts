// A small, AI-ready game harness. The shape is borrowed from DeepMind OpenSpiel:
// an immutable `Game` (metadata + a factory for fresh states) and a mutable
// `State` with a tiny core contract. A future AI player plugs in at the seam
// `legalActions()` / `actionFromString()` — exactly the "observation → action"
// interface Kaggle Game Arena wraps around. Rendering/AI live elsewhere; this
// module only knows about turn-based game logic.

/** `currentPlayer()` returns this once the game is over. */
export const TERMINAL = -1;

/**
 * `currentPlayer()` returns this at a CHANCE node — a stochastic event (a shuffle
 * or a deal) rather than a player's decision. Mirrors OpenSpiel's kChancePlayerId;
 * distinct from TERMINAL. Only imperfect-information games use it (see
 * `ImperfectInfoState`); perfect-information games never return it.
 */
export const CHANCE = -2;

export interface GameType {
  shortName: string;
  longName: string;
  numPlayers: number;
}

export interface GameState<A> {
  /** Whose turn it is (0-based player index), or `TERMINAL`. */
  currentPlayer(): number;
  /** All legal actions for the current player (empty at a terminal state). */
  legalActions(): A[];
  /** Apply an action in place, advancing to the next state. */
  applyAction(action: A): void;
  isTerminal(): boolean;
  /** Per-player utility once terminal: +1 win, -1 loss, 0 draw. */
  returns(): number[];
  /** Deep copy — needed for search/rollouts and move legality checks. */
  clone(): GameState<A>;
  /** Human-readable rendering of the position. */
  toString(): string;
  /** Canonical notation for an action (e.g. SAN for chess). */
  actionToString(action: A): string;
  /** Parse an action string (lenient — SAN or UCI for chess); null if illegal. */
  actionFromString(s: string): A | null;
}

export interface Game<S extends GameState<A>, A> {
  readonly type: GameType;
  newInitialState(): S;
}

// Imperfect-information extension (poker, etc.) — OPTIONAL, so perfect-information
// games (chess) implement none of it and are unchanged. Modeled on OpenSpiel's
// State, it adds the two things a hidden-information game needs on top of the base
// contract:
//
//   1. Chance nodes. Some turns are stochastic events (a shuffle/deal) rather than
//      a player's choice: `currentPlayer() === CHANCE`, `isChanceNode()` is true,
//      and the outcomes + probabilities come from `chanceOutcomes()`. A game may
//      expose dealing as explicit chance nodes the match loop resolves, OR deal
//      internally and never surface a chance node (then `isChanceNode()` is always
//      false and `chanceOutcomes()` returns []). Both satisfy this interface.
//
//   2. Per-player observation. `toString()` is the whole world — fine to render,
//      but an AI for player p must see ONLY what p knows. `informationStateString(p)`
//      is p's view (its own hole cards + the public betting/board history) with
//      no other player's hidden cards; it is what `ModelPlayer` prompts on instead
//      of the full state, so hidden information never leaks. `observationString(p)`
//      is the Markovian variant (may lack perfect recall) — often the same text for
//      simple games; kept separate to match OpenSpiel's two notions.
//
// `returns()` is already a per-player vector, so N-player / non-2-player payoffs
// need nothing new here.
export interface ImperfectInfoState<A> extends GameState<A> {
  /** True exactly when `currentPlayer() === CHANCE` (the next action is a draw). */
  isChanceNode(): boolean;
  /** At a chance node, the legal outcomes paired with their probabilities (∑ = 1);
   *  empty at a non-chance node. */
  chanceOutcomes(): { action: A; prob: number }[];
  /** Player `player`'s information state as a string: its private holdings + the
   *  public history, and NOTHING another player hides. The observation an AI is
   *  prompted with. Must remain valid at terminal states (for post-game logging). */
  informationStateString(player: number): string;
  /** A Markovian per-player observation (need not have perfect recall). May equal
   *  `informationStateString` for games without long-range hidden history. */
  observationString(player: number): string;
}
