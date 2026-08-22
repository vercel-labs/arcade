import { runMatch, type MatchScene } from '../../../ai/match.ts';
import { ModelPlayer } from '../../../ai/model-player.ts';
import { ChessGameRecorder } from '../../../arcade/match/game-recorders.ts';
import { normalizerModel } from '../../../arcade/match/models.ts';
import { ChessState, START_FEN } from '../../../rules/chess/chess.ts';
import type { Move } from '../../../rules/chess/types.ts';
import type { MatchLabAdapter } from '../types.ts';
import { mulberry32 } from '../random.ts';

class HeadlessChessScene implements MatchScene<Move> {
  constructor(private readonly game: ChessState) {}
  state(): ChessState { return this.game; }
  async playMove(action: Move): Promise<void> { this.game.applyAction(action); }
}

export const runChessMatch: MatchLabAdapter = async ({ plan, signal, emit }) => {
  if (plan.models.length !== 2) throw new RangeError('Chess needs exactly two models');
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const rng = mulberry32(plan.seed);
  const state = new ChessState();
  const scene = new HeadlessChessScene(state);
  const normalizer = normalizerModel();
  const recorder = new ChessGameRecorder(
    'ai_vs_ai',
    plan.models.map((model) => ({ kind: 'model' as const, model, runtime: 'text' as const })),
    START_FEN,
    false,
  );
  const players = plan.models.map((model, seat) => new ModelPlayer<Move>({
    model,
    name: model,
    gameName: 'chess',
    normalizer,
    fallbackRng: rng,
    onAttempt: (attempt) => emit({ type: 'model_attempt', game: 'chess', seat, model, data: attempt }),
  }));
  let plies = 0;
  let pendingSan = '';
  try {
    await runMatch(scene, players, {
      signal,
      shouldStop: () => plies >= plan.limits.maxPlies,
      onThinking: (_player, seat) => emit({ type: 'decision_started', game: 'chess', seat, model: plan.models[seat], action: plies + 1, data: { fen: state.fen() } }),
      onCommentary: (text, _player, seat) => emit({ type: 'commentary', game: 'chess', seat, model: plan.models[seat], action: plies + 1, data: { text } }),
      onActionChosen: ({ player, playerIndex, choice }) => {
        pendingSan = state.actionToString(choice.action);
        recorder.actionChosen(playerIndex, player, choice, state, false, false);
        emit({
          type: 'action_chosen', game: 'chess', seat: playerIndex, model: plan.models[playerIndex], action: plies + 1,
          data: { san: pendingSan, rationale: choice.rationale, diagnostics: choice.diagnostics },
        });
      },
      onActionApplied: ({ playerIndex }) => {
        plies++;
        recorder.actionApplied(state, pendingSan, false);
        emit({ type: 'action_applied', game: 'chess', seat: playerIndex, model: plan.models[playerIndex], action: plies, data: { san: pendingSan, fen: state.fen(), pgn: state.moveHistory() } });
      },
    });
  } catch (error) {
    if (!signal.aborted) throw error;
  }
  const result = state.result();
  const canonical = result
    ? recorder.completed(result, state.fen())
    : recorder.abandoned('user_stopped', state.fen());
  const endedAt = new Date().toISOString();
  return {
    id: plan.id,
    game: 'chess',
    status: result ? 'completed' : 'bounded',
    models: plan.models,
    seed: plan.seed,
    startedAt,
    endedAt,
    durationMs: Math.max(0, Math.round(performance.now() - started)),
    actionCount: plies,
    winnerSeats: result?.winner === null || result?.winner === undefined ? [] : [result.winner],
    stopReason: result?.reason ?? (signal.aborted ? 'timeout' : 'ply limit'),
    canonical,
    finalState: { fen: state.fen(), pgn: state.moveHistory(), result },
  };
};
