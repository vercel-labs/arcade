import type { GameState } from '../games/game.ts';
import type { Player } from './player.ts';

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
  while (!scene.state().isTerminal()) {
    if (signal?.aborted) break;
    const state = scene.state();
    const idx = state.currentPlayer();
    const player = players[idx];
    hooks.onThinking?.(player, idx);
    const { action, rationale } = await player.chooseAction(state, signal);
    if (signal?.aborted) break;
    if (rationale) hooks.onCommentary?.(rationale, player, idx);
    await scene.playMove(action);
  }
  return scene.state().returns();
}
