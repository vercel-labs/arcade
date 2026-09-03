import type { CommunicationMode } from '../../harness/communication/types.ts';

export type MatchLabGame = 'chess' | 'islanders' | 'poker';

export interface MatchLabLimits {
  timeoutMs: number;
  maxActions: number;
  maxPlies: number;
  maxHands: number;
}

export interface MatchLabPlan {
  id: string;
  index: number;
  game: MatchLabGame;
  models: string[];
  seed: number;
  limits: MatchLabLimits;
  startingChips: number;
  smallBlind: number;
  bigBlind: number;
  handsPerLevel: number;
  setupOnly: boolean;
  communicationMode: CommunicationMode;
  // Islanders: 'current' runs the shipped negotiation harness (per-seat offer policy + turn-end
  // notebooks); 'legacy' runs without either, as the baseline for A/B runs.
  harness: 'current' | 'legacy';
  // Record each model's private reasoning, retry feedback, and decision context in
  // model_attempt events. Evaluation artifacts only; never the arcade or telemetry.
  captureThinking: boolean;
}

export type MatchLabStatus = 'completed' | 'bounded' | 'failed';

export interface MatchLabResult {
  id: string;
  game: MatchLabGame;
  status: MatchLabStatus;
  models: string[];
  seed: number;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  actionCount: number;
  winnerSeats: number[];
  stopReason: string;
  canonical?: unknown;
  finalState?: unknown;
  error?: { name: string; message: string; code?: string; stack?: string };
}

export interface MatchLabEvent {
  runId: string;
  matchId?: string;
  at: string;
  type:
    | 'run_started'
    | 'run_finished'
    | 'match_started'
    | 'decision_started'
    | 'model_attempt'
    | 'reflection'
    | 'commentary'
    | 'communication_decision'
    | 'moment_detected'
    | 'communication_opportunity'
    | 'action_chosen'
    | 'action_applied'
    | 'state_checkpoint'
    | 'hand_started'
    | 'blind_level_changed'
    | 'hand_finished'
    | 'match_finished'
    | 'match_failed';
  game?: MatchLabGame;
  seat?: number;
  model?: string;
  action?: number;
  data?: unknown;
}

export type MatchLabEmit = (event: Omit<MatchLabEvent, 'runId' | 'matchId' | 'at'>) => void;

export interface MatchLabAdapterContext {
  plan: MatchLabPlan;
  signal: AbortSignal;
  emit: MatchLabEmit;
}

export type MatchLabAdapter = (context: MatchLabAdapterContext) => Promise<MatchLabResult>;

export interface MatchLabManifest {
  schemaVersion: 1;
  runId: string;
  createdAt: string;
  game: MatchLabGame;
  games: number;
  concurrency: number;
  models: string[];
  baseSeed: number;
  swapSeats: boolean;
  setupOnly: boolean;
  communicationMode: CommunicationMode;
  harness: 'current' | 'legacy';
  captureThinking: boolean;
  limits: MatchLabLimits;
  startingChips: number;
  smallBlind: number;
  bigBlind: number;
  handsPerLevel: number;
  gitCommit?: string;
  telemetry: 'disabled';
}

export interface MatchLabSummary {
  runId: string;
  game: MatchLabGame;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  requested: number;
  completed: number;
  bounded: number;
  failed: number;
  totalActions: number;
  resultsByModel: Record<string, { games: number; wins: number }>;
  matches: Array<Omit<MatchLabResult, 'canonical' | 'finalState' | 'error'> & { error?: string }>;
}
