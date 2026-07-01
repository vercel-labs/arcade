// A small, AI-ready game harness. The shape is borrowed from DeepMind OpenSpiel:
// an immutable `Game` (metadata + a factory for fresh states) and a mutable
// `State` with a tiny core contract. A future AI player plugs in at the seam
// `legalActions()` / `actionFromString()` — exactly the "observation → action"
// interface Kaggle Game Arena wraps around. Rendering/AI live elsewhere; this
// module only knows about turn-based game logic.

/** `currentPlayer()` returns this once the game is over. */
export const TERMINAL = -1;

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
