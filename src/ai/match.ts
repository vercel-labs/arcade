import type { GameState } from '../rules/game.ts';
import type { Player, TurnContext } from './player.ts';

// The rendering surface a match drives: the live game state plus a way to play
// (and visibly animate) one action. `ChessGameScene` implements this. Keeping it
// this thin lets `runMatch` stay engine/arcade-agnostic — it only needs to read
// the state and hand off a move, awaiting the scene's settle.
export interface MatchScene<A> {
  /** The authoritative live state — read-only use (legality, terminal, returns). */
  state(): GameState<A>;
  /** Animate + apply an action; resolves once the move has fully settled. */
  playMove(action: A): Promise<void>;
}

export interface MatchHooks<A> {
  /** Fired before a player is asked to move (turn indicator / spinner). */
  onThinking?(player: Player<A>, playerIndex: number): void;
  /** Fired with a player's rationale just before its move animates. */
  onCommentary?(text: string, player: Player<A>, playerIndex: number): void;
  /** Cancels the match between/within turns. */
  signal?: AbortSignal;
  /**
   * Optional phase boundary for partial-game harnesses. Checked before asking the next
   * player to act. Catan uses this to run model-driven initial placement without entering
   * its not-yet-implemented regular turns; full chess/poker matches leave it unset.
   */
  shouldStop?(state: GameState<A>): boolean;
}

// Drive two (or more) players through a game to its terminal state, alternating
// by `currentPlayer()`. This is the turn-based gating loop: the next inference is
// inhibited until the current move's animation settles (`await playMove`), so the
// board, the models, and the UI never race. Single source of truth = the scene's
// state; nothing is mirrored. Returns the per-player utility vector (`returns()`),
// or the current returns if aborted early.
export async function runMatch<A>(
  scene: MatchScene<A>,
  players: Player<A>[],
  hooks: MatchHooks<A> = {},
): Promise<number[]> {
  const { signal } = hooks;
  let lastSaid: string | undefined; // the previous mover's line, for opponent banter
  while (!scene.state().isTerminal() && !hooks.shouldStop?.(scene.state())) {
    if (signal?.aborted) break;
    const state = scene.state();
    const idx = state.currentPlayer();
    const player = players[idx];
    hooks.onThinking?.(player, idx);
    // Per-turn context. Commentary flows through `emit` (a voice player streams
    // speech chunks; a text player may not call it at all). If nothing was
    // emitted but a rationale came back, surface it once — so plain text players
    // keep working unchanged. `opponentSaid` lets this player react to the last
    // utterance without the caller threading it manually.
    let emitted = false;
    const ctx: TurnContext = {
      signal,
      emit: (chunk) => {
        emitted = true;
        hooks.onCommentary?.(chunk, player, idx);
      },
      opponentSaid: lastSaid,
    };
    const { action, rationale } = await player.chooseAction(state, ctx);
    if (signal?.aborted) break;
    if (!emitted && rationale) hooks.onCommentary?.(rationale, player, idx);
    if (rationale) lastSaid = rationale;
    await scene.playMove(action);
  }
  return scene.state().returns();
}
