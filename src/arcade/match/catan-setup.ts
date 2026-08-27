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

export const CATAN_SETUP_SPEECH_GUIDE =
  'one natural first-person sentence of live Catan table talk that names the visible placement and gives one useful public reason for it, such as production balance, number coverage, a port, or expansion room. Aim for a watchable explanation rather than a bare action caption, but do not recite the full private evaluation or longer-term plan. When the chosen action has a supplied public spot or route label, copy that label verbatim, such as 9🪨–5🐑–10🌾. Never use raw node, edge, or hex IDs or pip totals. Use "I" and "my" for your own position.';

export const CATAN_MOVE_NOTATION: MoveNotation = {
  description:
    'Use exactly one canonical Catan action from the legal-action context (setup, roll, build, robber, development card, trade, discard, or end).',
  examples: '"roll", "road 37", "offer 1/0/0/0/0 for 0/1/0/0/0", "counter 0/2/0/0/0 for 1/0/0/0/0", "end"',
};

export const CATAN_SPEECH_GUIDE =
  'one or two natural first-person sentences of live Catan table talk. State the visible action and, when it is strategically meaningful, give one concise public-facing reason based only on information everyone can see—for example that a player is leading, a tile is productive, a route is contested, a trade improves flexibility, or the timing is important. This should be watchable table talk, not merely an action caption, but keep detailed calculations, exact inventory logic, hidden information, and the longer-term plan in private thinking. Never reveal exact cards in your hand, development-card identities, hidden victory points, or private analysis. Use the public UI names wood, brick, sheep, wheat, and ore. When the chosen action has a supplied public spot, route, hex, trade, or player label, copy the relevant label verbatim instead of using raw N, E, H, node, edge, hex, seat, or P-number IDs. Name an affected opponent rather than saying a bare "you" or "your". For a trade, plainly say what I give and what I receive, with at most one public reason. Before a roll, do not claim a result; routine roll, pass, reject, and end-turn lines may stay under eight words. Use "I" and "my" for your own position.';

export type CatanSetupModelPlayerOpts = Omit<ModelPlayerOpts, 'gameName' | 'moveNotation' | 'rationaleGuide' | 'speech'>;

export function createCatanSetupModelPlayer(opts: CatanSetupModelPlayerOpts): ModelPlayer<CatanAction> {
  return new ModelPlayer<CatanAction>({
    ...opts,
    // Setup transcripts should remain reproducible when a model is unavailable or never
    // returns a valid action. Callers may inject a seeded generator; the default chooses
    // the first canonical legal action instead of consulting global Math.random.
    fallbackRng: opts.fallbackRng ?? (() => 0),
    gameName: 'Catan',
    moveNotation: CATAN_SETUP_MOVE_NOTATION,
    speech: CATAN_SETUP_SPEECH_GUIDE,
  });
}

export type CatanModelPlayerOpts = CatanSetupModelPlayerOpts;

export function createCatanModelPlayer(opts: CatanModelPlayerOpts): ModelPlayer<CatanAction> {
  return new ModelPlayer<CatanAction>({
    ...opts,
    gameName: 'Catan',
    moveNotation: CATAN_MOVE_NOTATION,
    speech: CATAN_SPEECH_GUIDE,
  });
}

export interface CatanSetupScene extends MatchScene<CatanAction> {
  state(): CatanState;
}

export type CatanSetupHooks = Omit<MatchHooks<CatanAction>, 'shouldStop'> & {
  /** Optional short smoke-test bound; normal setup runs through all placements. */
  maxActions?: number;
};

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
    onActionApplied: async (info) => {
      applied++;
      await onActionApplied?.(info);
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
  const { maxActions, onActionApplied, ...baseHooks } = hooks;
  if (maxActions !== undefined && (!Number.isInteger(maxActions) || maxActions <= 0)) {
    throw new RangeError(`maxActions must be a positive integer; received ${maxActions}`);
  }
  let applied = 0;
  let hitLimit = false;
  await runMatch(scene, players, {
    ...baseHooks,
    onActionApplied: async (info) => {
      applied++;
      await onActionApplied?.(info);
    },
    shouldStop: () => {
      if (scene.state().initialPlacementComplete()) return true;
      if (maxActions === undefined || applied < maxActions) return false;
      hitLimit = true;
      return true;
    },
  });
  if (hitLimit && !scene.state().initialPlacementComplete()) throw new CatanMatchActionLimitError(maxActions!);
  return scene.state();
}

function assertSeatCount(state: CatanState, players: readonly Player<CatanAction>[]): void {
  if (players.length !== state.n) {
    throw new RangeError(`Catan needs one player per seat; received ${players.length} for ${state.n} seats`);
  }
}
