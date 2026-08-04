// Model-harness entry points for Catan. The rules state is fully headless; a future board
// scene plugs in by implementing the same tiny `state()` / `playMove()` interface. The
// initial-placement runner remains useful for isolated setup benchmarks.

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
  'one concise public sentence about the production, complementary portfolio, number coverage, starting cards, port, or expansion value of your setup choice.';

export const CATAN_MOVE_NOTATION: MoveNotation = {
  description:
    'Use exactly one canonical Catan action from the legal-action context (setup, roll, build, robber, development card, trade, discard, or end).',
  examples: '"roll", "road 37", "settlement 12", "trade brick->ore", "end"',
};

export const CATAN_RATIONALE_GUIDE =
  'one concise public sentence grounded in the board, hand, production portfolio, opponents public state, timing, or legal action chosen.';

export type CatanSetupModelPlayerOpts = Omit<ModelPlayerOpts, 'gameName' | 'moveNotation' | 'rationaleGuide'>;

export function createCatanSetupModelPlayer(opts: CatanSetupModelPlayerOpts): ModelPlayer<CatanAction> {
  return new ModelPlayer<CatanAction>({
    ...opts,
    // Setup transcripts should remain reproducible when a model is unavailable or never
    // returns a valid action. Callers may inject a seeded generator; the default chooses
    // the first canonical legal action instead of consulting global Math.random.
    fallbackRng: opts.fallbackRng ?? (() => 0),
    gameName: 'Catan',
    moveNotation: CATAN_SETUP_MOVE_NOTATION,
    rationaleGuide: CATAN_SETUP_RATIONALE_GUIDE,
  });
}

export type CatanModelPlayerOpts = CatanSetupModelPlayerOpts;

export function createCatanModelPlayer(opts: CatanModelPlayerOpts): ModelPlayer<CatanAction> {
  return new ModelPlayer<CatanAction>({
    ...opts,
    gameName: 'Catan',
    moveNotation: CATAN_MOVE_NOTATION,
    rationaleGuide: CATAN_RATIONALE_GUIDE,
  });
}

export interface CatanSetupScene extends MatchScene<CatanAction> {
  state(): CatanState;
}

export type CatanSetupHooks = Omit<MatchHooks<CatanAction>, 'shouldStop'>;

export type CatanMatchHooks = MatchHooks<CatanAction> & {
  /** Safety bound for evaluations whose players may legally roll/end forever. */
  maxActions?: number;
};

export class CatanMatchActionLimitError extends Error {
  constructor(readonly maxActions: number) {
    super(`Catan match reached its ${maxActions}-action safety limit without a winner`);
    this.name = 'CatanMatchActionLimitError';
  }
}

export async function runCatanMatch(
  scene: CatanSetupScene,
  players: Player<CatanAction>[],
  hooks: CatanMatchHooks = {},
): Promise<CatanState> {
  assertSeatCount(scene.state(), players);
  const { maxActions = 10_000, onActionApplied, shouldStop, ...baseHooks } = hooks;
  if (!Number.isInteger(maxActions) || maxActions <= 0) throw new RangeError(`maxActions must be a positive integer; received ${maxActions}`);
  let applied = 0;
  let hitLimit = false;
  await runMatch(scene, players, {
    ...baseHooks,
    onActionApplied: (info) => {
      applied++;
      onActionApplied?.(info);
    },
    shouldStop: (state) => {
      if (shouldStop?.(state)) return true;
      if (applied < maxActions) return false;
      hitLimit = true;
      return true;
    },
  });
  if (hitLimit && !scene.state().isTerminal()) throw new CatanMatchActionLimitError(maxActions);
  return scene.state();
}

export async function runHeadlessCatanMatch(
  state: CatanState,
  players: Player<CatanAction>[],
  hooks: CatanMatchHooks = {},
): Promise<CatanState> {
  return runCatanMatch(
    {
      state: () => state,
      playMove: async (action) => state.applyAction(action),
    },
    players,
    hooks,
  );
}

export async function runCatanInitialPlacement(
  scene: CatanSetupScene,
  players: Player<CatanAction>[],
  hooks: CatanSetupHooks = {},
): Promise<CatanState> {
  assertSeatCount(scene.state(), players);
  await runMatch(scene, players, {
    ...hooks,
    shouldStop: () => scene.state().initialPlacementComplete(),
  });
  return scene.state();
}

function assertSeatCount(state: CatanState, players: readonly Player<CatanAction>[]): void {
  if (players.length !== state.n) {
    throw new RangeError(`Catan needs one player per seat; received ${players.length} for ${state.n} seats`);
  }
}
