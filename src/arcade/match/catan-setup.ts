// Model-harness entry point for Catan's independently playable initial-placement slice.
// It deliberately stops once the snake has produced two settlements + two roads per seat,
// before `runMatch` asks for the regular roll/build turn rules that are still staged.

import { type MatchHooks, type MatchScene, runMatch } from '../../ai/match.ts';
import { ModelPlayer, type ModelPlayerOpts, type MoveNotation } from '../../ai/model-player.ts';
import type { Player } from '../../ai/player.ts';
import type { CatanState } from '../../rules/catan/catan.ts';
import type { CatanAction } from '../../rules/catan/types.ts';

export const CATAN_SETUP_MOVE_NOTATION: MoveNotation = {
  description: 'Catan setup notation: init-settlement <node> or init-road <edge>',
  examples: '"init-settlement 12", "init-road 37"',
};

export const CATAN_SETUP_RATIONALE_GUIDE =
  'one concise public sentence about the production, resource diversity, port, or expansion value of your setup choice.';

export type CatanSetupModelPlayerOpts = Omit<ModelPlayerOpts, 'gameName' | 'moveNotation' | 'rationaleGuide'>;

export function createCatanSetupModelPlayer(opts: CatanSetupModelPlayerOpts): ModelPlayer<CatanAction> {
  return new ModelPlayer<CatanAction>({
    ...opts,
    gameName: 'Catan',
    moveNotation: CATAN_SETUP_MOVE_NOTATION,
    rationaleGuide: CATAN_SETUP_RATIONALE_GUIDE,
  });
}

export interface CatanSetupScene extends MatchScene<CatanAction> {
  state(): CatanState;
}

export type CatanSetupHooks = Omit<MatchHooks<CatanAction>, 'shouldStop'>;

export async function runCatanInitialPlacement(
  scene: CatanSetupScene,
  players: Player<CatanAction>[],
  hooks: CatanSetupHooks = {},
): Promise<CatanState> {
  if (players.length !== scene.state().n) {
    throw new RangeError(`Catan setup needs one player per seat; received ${players.length} for ${scene.state().n} seats`);
  }
  await runMatch(scene, players, {
    ...hooks,
    shouldStop: () => scene.state().initialPlacementComplete(),
  });
  return scene.state();
}
