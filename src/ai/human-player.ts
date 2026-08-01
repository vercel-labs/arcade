import type { GameState } from '../rules/game.ts';
import type { ActionChoice, Player, TurnContext } from './player.ts';

// A human-controlled `Player`: instead of computing a move, it awaits one from the
// UI. `awaitMove` is the seam the app wires to its board (e.g. ChessGameScene's
// requestHumanMove) — it resolves when the player commits a legal action and
// REJECTS if the turn is aborted (the match was paused or stopped), mirroring how
// ModelPlayer lets an abort propagate so `runMatch` unwinds cleanly. Implements the
// SAME Player seam as ModelPlayer, so a human and a model are interchangeable in a
// match (human-vs-AI, and hotseat human-vs-human, fall straight out of the loop).
// A human emits no rationale, so no commentary toast appears on their turn.
export class HumanPlayer<A> implements Player<A> {
  readonly name: string;

  constructor(private readonly opts: { name?: string; awaitMove: (state: GameState<A>, ctx?: TurnContext) => Promise<A> }) {
    this.name = opts.name ?? 'you';
  }

  async chooseAction(state: GameState<A>, ctx?: TurnContext): Promise<ActionChoice<A>> {
    const started = performance.now();
    const action = await this.opts.awaitMove(state, ctx);
    return {
      action,
      diagnostics: {
        resolution: 'human',
        durationMs: Math.max(0, Math.round(performance.now() - started)),
        attempts: [],
        illegalMode: false,
      },
    };
  }
}
