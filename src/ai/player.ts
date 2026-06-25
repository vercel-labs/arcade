import type { GameState } from '../games/game.ts';

// Per-turn context handed to a player when it's asked to move. Bundles the abort
// signal with the seams a real-time / voice player needs: an `emit` sink to
// STREAM commentary as it's produced (rather than only returning it at the end),
// and `opponentSaid` — the other side's last utterance, so a player can react to
// it. All fields optional, so a trivial player can ignore the context entirely.
export interface TurnContext {
  /** Aborts an in-flight decision (e.g. the match was cancelled or paused). */
  signal?: AbortSignal;
  /**
   * Sink for commentary as it is produced. A voice player streams speech chunks
   * through here in real time; a text player may call it once with its rationale
   * (or not at all — `runMatch` falls back to emitting the returned rationale).
   */
  emit?: (chunk: string) => void;
  /** The opponent's last rationale/utterance, for banter and reactions. */
  opponentSaid?: string;
}

// An agent that picks a move for whoever is to move. Generic over the action
// type `A`, so the same seam serves any harness game (the `GameState<A>` from
// games/game.ts is the whole observation). A human-input or search-based player
// could implement this too; `ModelPlayer` backs it with an LLM via AI Gateway,
// and a future real-time `VoicePlayer` implements the SAME method — streaming
// speech through `ctx.emit` and returning the move from a structured tool call.
export interface Player<A> {
  /** Short label for HUD/logs — the model slug for a `ModelPlayer`. */
  readonly name: string;
  /**
   * Choose a legal action for `state.currentPlayer()`. The returned `action`
   * MUST be legal in `state` (validated by implementations). `rationale` is the
   * canonical final commentary (logged / recorded); stream incremental commentary
   * through `ctx.emit` when possible. `ctx` is optional so trivial players can
   * ignore it; `ctx.signal` aborts an in-flight decision.
   */
  chooseAction(state: GameState<A>, ctx?: TurnContext): Promise<{ action: A; rationale?: string }>;
}
