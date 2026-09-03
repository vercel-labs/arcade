import type { GameState } from '../rules/game.ts';
import type { ActionChoice, Player } from './player.ts';

// A local, network-free `Player`: a pure function from the state's legal actions to one of
// them. The seat for practice opponents (the tutorial's bots), scripted openings, and
// deterministic tests — anywhere a table needs a body that plays instantly and never calls
// a model. `pick` receives the legal actions (never empty mid-game) and the state, and must
// return one of them; a `rationale` is optional and emits no commentary when omitted.
export class PolicyPlayer<A> implements Player<A> {
  readonly name: string;

  constructor(
    name: string,
    private readonly pick: (legal: readonly A[], state: GameState<A>) => A,
  ) {
    this.name = name;
  }

  async chooseAction(state: GameState<A>): Promise<ActionChoice<A>> {
    return { action: this.pick(state.legalActions(), state) };
  }
}
