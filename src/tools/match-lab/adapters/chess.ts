import { TableCommunicationCoordinator } from '../../../harness/communication/coordinator.ts';
import {
  CHESS_AMBIENT_GUIDE,
  ChessGameRecorder,
  chessActionSalience,
  createChessModelPlayer,
  runHeadlessChessMatch,
} from '../../../harness/games/chess/index.ts';
import { normalizerModel } from '../../../arcade/match/models.ts';
import { ChessState, START_FEN } from '../../../rules/chess/chess.ts';
import type { MatchLabAdapter } from '../types.ts';
import { mulberry32 } from '../random.ts';

export const runChessMatch: MatchLabAdapter = async ({ plan, signal, emit }) => {
  if (plan.models.length !== 2) throw new RangeError('Chess needs exactly two models');
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const rng = mulberry32(plan.seed);
  const state = new ChessState();
  const normalizer = normalizerModel();
  const communication = plan.communicationMode === 'ambient'
    ? new TableCommunicationCoordinator('ambient', plan.models, CHESS_AMBIENT_GUIDE)
    : null;
  const recorder = new ChessGameRecorder(
    'ai_vs_ai',
    plan.models.map((model) => ({ kind: 'model' as const, model, runtime: 'text' as const })),
    START_FEN,
    false,
  );
  const players = plan.models.map((model, seat) => createChessModelPlayer({
    model,
    name: model,
    normalizer,
    fallbackRng: rng,
    ...(communication ? {
      communication: communication.modelConfig(),
      contextProvider: () => communication.contextFor(seat),
    } : {}),
    onAttempt: (attempt) => emit({ type: 'model_attempt', game: 'chess', seat, model, data: attempt }),
    captureThinking: plan.captureThinking,
  }));
  let plies = 0;
  let pendingSan = '';
  try {
    await runHeadlessChessMatch(state, players, {
      signal,
      maxPlies: plan.limits.maxPlies,
      onThinking: (_player, seat) => emit({ type: 'decision_started', game: 'chess', seat, model: plan.models[seat], action: plies + 1, data: { fen: state.fen() } }),
      onCommentary: (text, _player, seat) => emit({ type: 'commentary', game: 'chess', seat, model: plan.models[seat], action: plies + 1, data: { text } }),
      onActionChosen: ({ player, playerIndex, choice }) => {
        pendingSan = state.actionToString(choice.action);
        recorder.actionChosen(playerIndex, player, choice, state, false, false);
        if (communication) {
          const decision = communication.decide(playerIndex, choice.communication, plies + 1, chessActionSalience(pendingSan));
          emit({ type: 'communication_decision', game: 'chess', seat: playerIndex, model: plan.models[playerIndex], action: plies + 1, data: decision });
          if (decision.communication.mode === 'speak') emit({ type: 'commentary', game: 'chess', seat: playerIndex, model: plan.models[playerIndex], action: plies + 1, data: { text: decision.communication.text, intent: decision.communication.intent } });
        }
        emit({
          type: 'action_chosen', game: 'chess', seat: playerIndex, model: plan.models[playerIndex], action: plies + 1,
          data: { san: pendingSan, rationale: choice.rationale, communication: choice.communication, diagnostics: choice.diagnostics },
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
    finalState: { fen: state.fen(), pgn: state.moveHistory(), result, ...(communication ? { communication: communication.summary() } : {}) },
  };
};
