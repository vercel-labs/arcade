import type { GameState } from '../games/game.ts';

// An agent that picks a move for whoever is to move. Generic over the action
// type `A`, so the same seam serves any harness game (the `GameState<A>` from
// games/game.ts is the whole observation). A human-input or search-based player
// could implement this too; `ModelPlayer` backs it with an LLM via AI Gateway.
export interface Player<A> {
  /** Short label for HUD/logs — the model slug for a `ModelPlayer`. */
  readonly name: string;
  /**
   * Choose a legal action for `state.currentPlayer()`. The returned `action`
   * MUST be legal in `state` (validated by implementations). `rationale` is an
   * optional one-line explanation surfaced as pre-move commentary. `signal`
   * aborts an in-flight decision (e.g. the match was cancelled).
   */
  chooseAction(state: GameState<A>, signal?: AbortSignal): Promise<{ action: A; rationale?: string }>;
}
