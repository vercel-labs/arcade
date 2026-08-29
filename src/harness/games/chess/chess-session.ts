import type { ChessState } from '../../../rules/chess/chess.ts';
import type { Move } from '../../../rules/chess/types.ts';
import { type MatchHooks, type MatchScene, runMatch } from '../../match.ts';
import { ModelPlayer, type ModelPlayerOpts, type MoveNotation } from '../../model-player.ts';
import type { Player } from '../../player.ts';

export const CHESS_DEFAULT_MAX_PLIES = 300;

export const CHESS_MOVE_NOTATION: MoveNotation = {
  description: 'a legal chess move in SAN or UCI notation',
  examples: '"e4", "Nf3", "O-O", "e7e8q"',
};

export const CHESS_AMBIENT_GUIDE =
  'Public speech is optional chess-table conversation, not move notation or an engine annotation. Speak for a genuine reaction, concise banter, or a short visible strategic observation. Do not announce every move, expose hidden chain-of-thought, or restate the UI. Usually choose silence.';

export type ChessModelPlayerOpts = Omit<ModelPlayerOpts, 'gameName' | 'moveNotation'>;

export function createChessModelPlayer(opts: ChessModelPlayerOpts): ModelPlayer<Move> {
  return new ModelPlayer<Move>({
    ...opts,
    gameName: 'chess',
    moveNotation: CHESS_MOVE_NOTATION,
  });
}

export function chessActionSalience(san: string): number {
  if (san.includes('#')) return 0.98;
  if (san.includes('+') || san.includes('=')) return 0.72;
  if (san.includes('x') || san.startsWith('O-O')) return 0.52;
  return 0.1;
}

export interface ChessMatchScene extends MatchScene<Move> {
  state(): ChessState;
}

export type ChessMatchHooks = MatchHooks<Move> & {
  /** Safety bound for evaluators; ordinary chess games virtually never reach 300 plies. */
  maxPlies?: number;
};

export interface ChessMatchResult {
  state: ChessState;
  plies: number;
  status: 'completed' | 'bounded';
}

export async function runChessMatch(
  scene: ChessMatchScene,
  players: Player<Move>[],
  hooks: ChessMatchHooks = {},
): Promise<ChessMatchResult> {
  if (players.length !== 2) throw new RangeError(`Chess needs exactly two players; received ${players.length}`);
  const { maxPlies = CHESS_DEFAULT_MAX_PLIES, onActionApplied, shouldStop, ...baseHooks } = hooks;
  if (!Number.isInteger(maxPlies) || maxPlies <= 0) {
    throw new RangeError(`maxPlies must be a positive integer; received ${maxPlies}`);
  }
  let plies = 0;
  await runMatch(scene, players, {
    ...baseHooks,
    onActionApplied: async (info) => {
      plies++;
      await onActionApplied?.(info);
    },
    shouldStop: (state) => shouldStop?.(state) === true || plies >= maxPlies,
  });
  return {
    state: scene.state(),
    plies,
    status: scene.state().isTerminal() ? 'completed' : 'bounded',
  };
}

export async function runHeadlessChessMatch(
  state: ChessState,
  players: Player<Move>[],
  hooks: ChessMatchHooks = {},
): Promise<ChessMatchResult> {
  return runChessMatch(
    {
      state: () => state,
      playMove: async (move) => state.applyAction(move),
    },
    players,
    hooks,
  );
}
