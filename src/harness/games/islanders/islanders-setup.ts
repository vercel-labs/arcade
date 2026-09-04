// Model-harness entry points for Islanders. The rules state is fully headless; a future board
// scene plugs in by implementing the same tiny `state()` / `playMove()` interface. The
// initial-placement runner remains useful for isolated setup benchmarks.

import { type MatchHooks, type MatchScene, runMatch } from '../../match.ts';
import { ModelPlayer, type ModelPlayerOpts, type MoveNotation } from '../../model-player.ts';
import type { Player } from '../../player.ts';
import type { IslandersState } from '../../../rules/islanders/islanders.ts';
import type { IslandersAction } from '../../../rules/islanders/types.ts';

// The rulebook a player has read before sitting down, and nothing more: what the game is,
// what scores, what things cost, and what each card does. It ranks nothing and names no
// strategy, so what a model values is its own decision. Sent as the system prompt.
export const ISLANDERS_RULES_PRIMER = [
  'You are playing Islanders, a settle-the-island board game, against the other players at the table.',
  'Goal: the first player to hold 10 victory points on their own turn wins. Settlement 1 VP; city 2 VP (a city replaces one of your settlements); Longest Road 2 VP for the longest unbroken chain of your roads, 5 or more segments, which passes to a player who builds a strictly longer one; Largest Army 2 VP for 3 or more knights played, which passes to a player who plays strictly more; each Victory Point development card is 1 VP, kept hidden and counted automatically.',
  'Setup: players place two settlements and a road beside each, in snake order; the second settlement pays 1 of each resource its hexes produce. A hex produces the resource of its terrain (forest wood, hills brick, pasture sheep, fields wheat, mountains ore); the desert produces nothing.',
  'Costs: road = 1 wood + 1 brick. Settlement = 1 wood + 1 brick + 1 sheep + 1 wheat. City = 3 ore + 2 wheat. Development card = 1 ore + 1 wheat + 1 sheep. Each player has 15 roads, 5 settlements, and 4 cities in total.',
  'Placement: a road must touch one of your roads or buildings. A settlement must touch one of your roads and sit at least two edges from every other settlement or city. A city is built on your own settlement.',
  'Turn: roll two dice; every hex showing that number pays 1 of its resource to each settlement touching it and 2 to each city, unless the robber sits on it. Then build, trade, and play at most one development card, in any order, and end your turn. Nothing requires you to build or trade on a turn: cards you keep carry over and combine with later rolls, bank or port exchanges, or player trades. Development cards bought this turn cannot be played until your next turn.',
  'A roll of 7 pays nothing. Every player holding more than 7 cards discards half of their hand, rounded down. The roller then moves the robber to a new hex and steals 1 random card from a player who has a building on that hex and cards in hand.',
  'Development deck, 25 cards: 14 Knight (move the robber and steal, as on a 7), 5 Victory Point, 2 Road Building (place 2 roads free), 2 Year of Plenty (take any 2 resources from the bank), 2 Monopoly (name a resource; every other player hands you all of theirs). Victory Point cards are never played; they count when you win.',
  'Trading, all on your own turn. Bank: 4 identical cards for any 1 card. Port: a settlement or city on a port lets you trade at that port; a generic port takes 3 identical cards for any 1, a resource port takes 2 of its resource for any 1. Players: propose any exchange of cards to the other players; each may accept, reject, or counter with a different exchange; you then complete the trade with one of them or cancel. Other players cannot trade among themselves during your turn, and no one can trade with the bank on another player\'s turn.',
  'Table talk is public and non-binding: promises made in speech are not enforced by the game.',
].join(' ');

export const ISLANDERS_SETUP_MOVE_NOTATION: MoveNotation = {
  description: 'Islanders setup notation: init-settlement <node> or init-road <edge>',
  examples: '"init-settlement 12", "init-road 37"',
};

export const ISLANDERS_SETUP_SPEECH_GUIDE =
  'one natural first-person sentence of live Islanders table talk that names the visible placement and gives one useful public reason for it, such as production balance, number coverage, a port, or expansion room. Aim for a watchable explanation rather than a bare action caption, but do not recite the full private evaluation or longer-term plan. When the chosen action has a supplied public spot or route label, copy that label verbatim, such as 9🪨–5🐑–10🌾. Never use raw node, edge, or hex IDs or pip totals. Use "I" and "my" for your own position.';

export const ISLANDERS_MOVE_NOTATION: MoveNotation = {
  description:
    'Use exactly one canonical Islanders action from the legal-action context (setup, roll, build, robber, development card, trade, discard, or end).',
  examples: '"roll", "road 37", "offer 1/0/0/0/0 for 0/1/0/0/0", "counter 0/2/0/0/0 for 1/0/0/0/0", "end"',
};

export const ISLANDERS_SPEECH_GUIDE =
  'one or two natural first-person sentences of live Islanders table talk. State the visible action and, when it is strategically meaningful, give one concise public-facing reason based only on information everyone can see—for example that a player is leading, a tile is productive, a route is contested, a trade improves flexibility, or the timing is important. This should be watchable table talk, not merely an action caption, but keep detailed calculations, exact inventory logic, hidden information, and the longer-term plan in private thinking. Never reveal exact cards in your hand, development-card identities, hidden victory points, or private analysis. Use the public UI names wood, brick, sheep, wheat, and ore. When the chosen action has a supplied public spot, route, hex, trade, or player label, copy the relevant label verbatim instead of using raw N, E, H, node, edge, hex, seat, or P-number IDs. Name an affected opponent rather than saying a bare "you" or "your". For a trade, plainly say what I give and what I receive, with at most one public reason. Before a roll, do not claim a result; routine roll, pass, reject, and end-turn lines may stay under eight words. Use "I" and "my" for your own position.';

export type IslandersSetupModelPlayerOpts = Omit<ModelPlayerOpts, 'gameName' | 'moveNotation' | 'rationaleGuide' | 'speech'>;

export function createIslandersSetupModelPlayer(opts: IslandersSetupModelPlayerOpts): ModelPlayer<IslandersAction> {
  return new ModelPlayer<IslandersAction>({
    ...opts,
    // Setup transcripts should remain reproducible when a model is unavailable or never
    // returns a valid action. Callers may inject a seeded generator; the default chooses
    // the first canonical legal action instead of consulting global Math.random.
    fallbackRng: opts.fallbackRng ?? (() => 0),
    gameName: 'Islanders',
    moveNotation: ISLANDERS_SETUP_MOVE_NOTATION,
    speech: ISLANDERS_SETUP_SPEECH_GUIDE,
  });
}

export type IslandersModelPlayerOpts = IslandersSetupModelPlayerOpts;

export function createIslandersModelPlayer(opts: IslandersModelPlayerOpts): ModelPlayer<IslandersAction> {
  return new ModelPlayer<IslandersAction>({
    ...opts,
    gameName: 'Islanders',
    moveNotation: ISLANDERS_MOVE_NOTATION,
    speech: ISLANDERS_SPEECH_GUIDE,
  });
}

export interface IslandersSetupScene extends MatchScene<IslandersAction> {
  state(): IslandersState;
}

export type IslandersSetupHooks = Omit<MatchHooks<IslandersAction>, 'shouldStop'> & {
  /** Optional short smoke-test bound; normal setup runs through all placements. */
  maxActions?: number;
};

export type IslandersMatchHooks = MatchHooks<IslandersAction> & {
  /** Safety bound for evaluations whose players may legally roll/end forever. */
  maxActions?: number;
};

export interface IslandersMatchResult {
  state: IslandersState;
  actionCount: number;
  status: 'completed' | 'bounded';
  stopReason: 'victory' | 'action_limit' | 'stopped' | 'aborted';
}

export class IslandersMatchActionLimitError extends Error {
  constructor(readonly maxActions: number) {
    super(`Islanders match reached its ${maxActions}-action safety limit without a winner`);
    this.name = 'IslandersMatchActionLimitError';
  }
}

export async function runIslandersMatch(
  scene: IslandersSetupScene,
  players: Player<IslandersAction>[],
  hooks: IslandersMatchHooks = {},
): Promise<IslandersMatchResult> {
  assertSeatCount(scene.state(), players);
  const { maxActions = 8_000, onActionApplied, shouldStop, ...baseHooks } = hooks;
  if (!Number.isInteger(maxActions) || maxActions <= 0) throw new RangeError(`maxActions must be a positive integer; received ${maxActions}`);
  let applied = 0;
  let hitLimit = false;
  let requestedStop = false;
  await runMatch(scene, players, {
    ...baseHooks,
    onActionApplied: async (info) => {
      applied++;
      await onActionApplied?.(info);
    },
    shouldStop: (state) => {
      if (shouldStop?.(state)) {
        requestedStop = true;
        return true;
      }
      if (applied < maxActions) return false;
      hitLimit = true;
      return true;
    },
  });
  const state = scene.state();
  return {
    state,
    actionCount: applied,
    status: state.isTerminal() ? 'completed' : 'bounded',
    stopReason: state.isTerminal()
      ? 'victory'
      : hitLimit
        ? 'action_limit'
        : hooks.signal?.aborted
          ? 'aborted'
          : requestedStop
            ? 'stopped'
            : 'stopped',
  };
}

export async function runHeadlessIslandersMatch(
  state: IslandersState,
  players: Player<IslandersAction>[],
  hooks: IslandersMatchHooks = {},
): Promise<IslandersMatchResult> {
  return runIslandersMatch(
    {
      state: () => state,
      playMove: async (action) => state.applyAction(action),
    },
    players,
    hooks,
  );
}

export async function runIslandersInitialPlacement(
  scene: IslandersSetupScene,
  players: Player<IslandersAction>[],
  hooks: IslandersSetupHooks = {},
): Promise<IslandersState> {
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
  if (hitLimit && !scene.state().initialPlacementComplete()) throw new IslandersMatchActionLimitError(maxActions!);
  return scene.state();
}

function assertSeatCount(state: IslandersState, players: readonly Player<IslandersAction>[]): void {
  if (players.length !== state.n) {
    throw new RangeError(`Islanders needs one player per seat; received ${players.length} for ${state.n} seats`);
  }
}
