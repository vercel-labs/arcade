/**
 * Public agent/game orchestration primitives.
 *
 * This layer deliberately does not resolve credentials, choose an AI provider,
 * publish telemetry, or own a terminal UI. Applications provide a model (or a
 * custom Player), a rules state, and an optional scene that settles actions.
 */
export { HumanPlayer } from './human-player.ts';
export {
  FALLBACK_RATIONALE,
  ModelPlayer,
  isFallbackRationale,
  type ModelPlayerOpts,
  type MoveNotation,
} from './model-player.ts';
export { classifyModelError } from './model-errors.ts';
export { runMatch, type MatchHooks, type MatchScene } from './match.ts';
export {
  RECORD_SCHEMA_VERSION,
  type CanonicalAction,
  type CanonicalGameRecord,
  type ChessMatchRecord,
  type ControllerAssignment,
  type ParticipantResult,
  type PokerHandRecord,
  type PokerMatchRecord,
  type RecordEndReason,
  type RecordParticipant,
  type RecordStatus,
} from './records.ts';
export type {
  ActionChoice,
  DecisionAttempt,
  DecisionAttemptPhase,
  DecisionAttemptResult,
  DecisionDiagnostics,
  DecisionFailureKind,
  DecisionResolution,
  Player,
  TurnContext,
} from './player.ts';
