import { CHANCE, type GameState, type ImperfectInfoState } from '../rules/game.ts';
import type { ActionChoice, Player, TurnContext } from './player.ts';

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
  /**
   * Fired after a decision is accepted but before the action is applied. `state`
   * is authoritative for the pre-action position during this synchronous callback.
   */
  onActionChosen?(info: MatchActionEvent<A>): void;
  /** Fired after playMove settles and the authoritative state contains the action. */
  onActionApplied?(info: MatchActionEvent<A>): void | Promise<void>;
  /** Fired when an explicit stochastic node has selected an outcome. */
  onChanceChosen?(info: MatchChanceEvent<A>): void;
  /** Fired after the selected stochastic outcome has been applied. */
  onChanceApplied?(info: MatchChanceEvent<A>): void | Promise<void>;
  /** Deterministic chance source for tests/replays. Defaults to Math.random. */
  chanceRng?: () => number;
  /** Cancels the match between/within turns. */
  signal?: AbortSignal;
  /**
   * Optional phase boundary for partial-game harnesses. Checked before asking the next
   * player to act. Islanders uses this for setup-only benchmarks; full matches leave it unset.
   */
  shouldStop?(state: GameState<A>): boolean;
}

export interface MatchActionEvent<A> {
  /** The exact Player captured at the start of the turn, even if the seats swap later. */
  player: Player<A>;
  playerIndex: number;
  choice: ActionChoice<A>;
  state: GameState<A>;
}

export interface MatchChanceEvent<A> {
  action: A;
  probability: number;
  state: GameState<A>;
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
  const { signal, chanceRng = Math.random } = hooks;
  let lastSaid: string | undefined; // the previous mover's line, for opponent banter
  while (!scene.state().isTerminal() && !hooks.shouldStop?.(scene.state())) {
    if (signal?.aborted) break;
    const state = scene.state();
    const idx = state.currentPlayer();
    if (idx === CHANCE) {
      const chanceState = asChanceState(state);
      const selected = sampleChanceOutcome(chanceState.chanceOutcomes(), chanceRng);
      hooks.onChanceChosen?.({ action: selected.action, probability: selected.prob, state });
      await scene.playMove(selected.action);
      await hooks.onChanceApplied?.({ action: selected.action, probability: selected.prob, state: scene.state() });
      continue;
    }
    const player = players[idx];
    if (!player) throw new RangeError(`No player implementation for active seat ${idx}`);
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
    const choice = await player.chooseAction(state, ctx);
    if (signal?.aborted) break;
    const { action, rationale } = choice;
    hooks.onActionChosen?.({ player, playerIndex: idx, choice, state });
    if (!emitted && rationale) hooks.onCommentary?.(rationale, player, idx);
    if (rationale) lastSaid = rationale;
    await scene.playMove(action);
    await hooks.onActionApplied?.({ player, playerIndex: idx, choice, state: scene.state() });
  }
  return scene.state().returns();
}

function asChanceState<A>(state: GameState<A>): ImperfectInfoState<A> {
  const candidate = state as Partial<ImperfectInfoState<A>>;
  if (candidate.isChanceNode?.() !== true || typeof candidate.chanceOutcomes !== 'function') {
    throw new TypeError('currentPlayer() returned CHANCE, but the state does not expose an explicit chance node');
  }
  return state as ImperfectInfoState<A>;
}

function sampleChanceOutcome<A>(
  outcomes: readonly { action: A; prob: number }[],
  rng: () => number,
): { action: A; prob: number } {
  if (outcomes.length === 0) throw new RangeError('A chance node must expose at least one outcome');
  let total = 0;
  for (const outcome of outcomes) {
    if (!Number.isFinite(outcome.prob) || outcome.prob < 0) {
      throw new RangeError(`Chance probabilities must be finite and non-negative; received ${outcome.prob}`);
    }
    total += outcome.prob;
  }
  if (Math.abs(total - 1) > 1e-6) {
    throw new RangeError(`Chance probabilities must sum to 1; received ${total}`);
  }
  const roll = rng();
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) {
    throw new RangeError(`chanceRng must return a finite value in [0, 1); received ${roll}`);
  }
  let cumulative = 0;
  for (const outcome of outcomes) {
    cumulative += outcome.prob;
    if (roll < cumulative) return outcome;
  }
  return outcomes[outcomes.length - 1];
}
