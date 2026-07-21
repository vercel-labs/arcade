import { randomUUID } from 'node:crypto';

// Canonical game records are deliberately narrower than arbitrary telemetry events.
// There are no free-form prompt, reasoning, chat, voice, or error fields here: the
// record is the mechanical game state needed for replay + leaderboard analytics.

export const RECORD_SCHEMA_VERSION = 1 as const;

export type RecordStatus = 'in_progress' | 'completed' | 'abandoned';
export type RecordEndReason =
  | 'natural'
  | 'user_stopped'
  | 'navigation'
  // Finalized while the process was exiting unexpectedly (uncaught error / crash); the
  // record is written to the durable outbox synchronously before exit.
  | 'process_exit_recovered';

export interface RecordParticipant {
  participantId: string;
  kind: 'human' | 'model';
  /** Stable match-local role: chess color, poker seat, Catan color, etc. */
  role: string;
}

export interface ControllerAssignment {
  assignmentId: string;
  participantId: string;
  controllerKind: 'human' | 'model';
  requestedModel?: string;
  resolvedModel?: string;
  runtime?: 'text' | 'realtime';
  /**
   * Pseudonymous per-install key for a HUMAN controller (a hash of the anonymous install
   * id) — the human's equivalent of a model's slug, so a person and a model are compared
   * as uniform "competitors". Absent for model controllers; carries no account identity.
   */
  playerKey?: string;
  startActionSeq: number;
  endActionSeq?: number;
}

export interface DecisionDiagnostics {
  latencyMs?: number;
  attemptCount?: number;
  illegalAttemptCount?: number;
  providerErrorCount?: number;
  normalized?: boolean;
  randomFallback?: boolean;
  fallbackReason?: 'exhausted' | 'unavailable';
  resolution?: 'human' | 'structured' | 'text' | 'normalized' | 'random-fallback';
  attempts?: {
    phase: 'structured' | 'text' | 'normalize';
    result: 'accepted' | 'rejected' | 'error';
    rejectionReason?: 'illegal' | 'unparseable';
    failureKind?: 'access' | 'schema' | 'timeout' | 'transient' | 'unknown';
    latencyMs: number;
    inputTokens?: number;
    outputTokens?: number;
  }[];
}

export interface CanonicalAction<TApplied, TRequested = TApplied> extends DecisionDiagnostics {
  actionId: string;
  seq: number;
  participantId: string;
  assignmentId: string;
  phase: string;
  /** A structured request only; never the model's raw textual response. */
  requested?: TRequested;
  /** The canonical action actually applied by the rules engine. */
  applied: TApplied;
}

export interface ParticipantResult {
  participantId: string;
  result: 'win' | 'loss' | 'draw' | 'unranked';
  rank?: number;
  tieGroup?: number;
  score?: number;
  utility?: number;
  placementMin?: number;
  placementMax?: number;
}

export interface CanonicalRecordBase {
  recordSchemaVersion: typeof RECORD_SCHEMA_VERSION;
  recordId: string;
  revision: number;
  matchId: string;
  game: string;
  rulesVersion: string;
  status: RecordStatus;
  endReason?: RecordEndReason;
  startedAt: string;
  endedAt?: string;
  lastActionSeq: number;
}

export interface MatchRecord<TGame extends string, TAction, TDetails> extends CanonicalRecordBase {
  recordType: 'match';
  game: TGame;
  participants: RecordParticipant[];
  controllerAssignments: ControllerAssignment[];
  actions: Array<CanonicalAction<TAction>>;
  results: ParticipantResult[];
  details: TDetails;
}

export interface ChessAppliedAction {
  uci: string;
  san: string;
  legal: boolean;
  /** Only retained for permissive/illegal-mode games, which standard PGN cannot replay. */
  fenBefore?: string;
  /** Only retained for permissive/illegal-mode games, which standard PGN cannot replay. */
  fenAfter?: string;
  from: string;
  to: string;
  movingPiece: string;
  capturedPiece?: string;
  promotion?: string;
  flags: string[];
}

export interface ChessMatchDetails {
  mode: 'ai_vs_ai' | 'human_vs_ai' | 'hotseat';
  initialFen: string;
  endingFen: string;
  allowIllegalMoves: boolean;
  resultReason?: 'checkmate' | 'stalemate' | 'fifty-move' | 'repetition' | 'insufficient-material';
}

export type ChessMatchRecord = MatchRecord<'chess', ChessAppliedAction, ChessMatchDetails>;

export interface PokerMatchDetails {
  mode: 'ai_table' | 'human_table' | 'mixed';
  tableSize: number;
  smallBlind: number;
  bigBlind: number;
  startingStacks: number[];
  finalStacks?: number[];
  handCount: number;
  lastCompletedHandNumber: number;
  /** Match-local participant ids in elimination order, earliest first. */
  eliminationOrder: string[];
}

export type PokerMatchRecord = MatchRecord<'poker', never, PokerMatchDetails>;

export type PokerActionKind = 'fold' | 'check' | 'call' | 'bet' | 'raise';

export type PokerRequestedAction =
  | { kind: 'fold' | 'check' | 'call' | 'allin' }
  | { kind: 'bet'; amount: number }
  | { kind: 'raise'; amountTo: number };

export interface PokerAppliedAction {
  kind: PokerActionKind;
  /** True when the applied action committed the participant's remaining stack. */
  allIn: boolean;
  /** The rules engine clamped or normalized the requested action. */
  adjusted: boolean;
  /** Total street commitment after the action, when applicable. */
  amountTo?: number;
  amountAdded: number;
  potBefore: number;
  stackBefore: number;
  toCallBefore: number;
}

export interface PokerCardDeal {
  /** Standard rank+suit code such as "As" or "Td", independent of engine encoding. */
  card: string;
  /** Absent for a community card. */
  dealtToParticipantId?: string;
  /** Hole-card visibility at hand end; community cards use `public`. */
  disposition?: 'shown' | 'folded_hidden' | 'winner_not_shown' | 'private_in_progress' | 'not_dealt' | 'public';
  dealtAtActionSeq: number;
  /** Absent when the card was never public (folded/mucked hole cards). */
  publicAtActionSeq?: number;
}

export interface PokerAward {
  participantId: string;
  amount: number;
  potIndex: number;
}

export interface PokerHandResult {
  participantId: string;
  dealtIn: boolean;
  startingStack: number;
  endingStack: number;
  committed: number;
  awarded: number;
  netChips: number;
  folded: boolean;
  reachedShowdown: boolean;
  wonAnyPot: boolean;
}

export interface PokerHandRecord extends CanonicalRecordBase {
  recordType: 'poker_hand';
  game: 'poker';
  handId: string;
  handNumber: number;
  participants: RecordParticipant[];
  controllerAssignments: ControllerAssignment[];
  buttonParticipantId: string;
  smallBlindParticipantId: string;
  bigBlindParticipantId: string;
  smallBlind: number;
  bigBlind: number;
  finalStreet: 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
  cards: PokerCardDeal[];
  actions: Array<CanonicalAction<PokerAppliedAction, PokerRequestedAction>>;
  awards: PokerAward[];
  results: PokerHandResult[];
}

export type CanonicalGameRecord = ChessMatchRecord | PokerMatchRecord | PokerHandRecord;

export type RecordTarget = 'match' | 'poker_hand';

export interface CanonicalRecordRow {
  emittedAt: string;
  sessionId: string;
  /** Pseudonymous per-install key when a human played (else ''); links a user's own games. */
  playerKey: string;
  environment: 'dev' | 'prod';
  appVersion: string;
  recordType: CanonicalGameRecord['recordType'];
  recordSchemaVersion: number;
  recordId: string;
  recordRevision: number;
  matchId: string;
  handId: string;
  handNumber: number;
  game: string;
  rulesVersion: string;
  status: RecordStatus;
  endReason: string;
  startedAt: string;
  /** Omitted while in progress; the datasource's DEFAULT (epoch) fills the column. */
  endedAt?: string;
  participantCount: number;
  actionCount: number;
  payloadJson: string;
}

const FORBIDDEN_KEYS = new Set([
  'prompt',
  'systemprompt',
  'reasoning',
  'thinking',
  'chat',
  'voice',
  'transcript',
  'rationale',
  'commentary',
  'raw',
  'rawresponse',
  'error',
  'errormessage',
  'providererror',
  'message',
]);

// Ceiling for one canonical record. Kept well under downstream ingestion limits
// (o11y-ingestion's request cap and Firehose's ~1 MB record) so a well-formed game is
// never rejected mid-pipeline; real chess/poker records are only kilobytes. The proxy
// enforces the same bound, so the client does not enqueue a record the proxy would 413.
export const MAX_RECORD_BYTES = 900 * 1024;

// Defense in depth for callers crossing a type boundary. Reject the whole record rather
// than risk persisting an accidentally attached prompt or transcript in the local outbox.
export function isPrivacySafeRecord(value: unknown, seen = new Set<object>()): boolean {
  // Optional typed properties commonly exist as `undefined`; JSON.stringify omits
  // them from objects, so they carry no payload and are safe to accept.
  if (value === undefined || value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true;
  if (typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.every((item) => isPrivacySafeRecord(item, seen));
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key.replace(/[_-]/g, '').toLowerCase())) return false;
    if (!isPrivacySafeRecord(nested, seen)) return false;
  }
  return true;
}

export function createRecordId(): string {
  return randomUUID();
}

export function recordTarget(record: CanonicalGameRecord): RecordTarget {
  return record.recordType === 'poker_hand' ? 'poker_hand' : 'match';
}

export function toCanonicalRecordRow(
  record: CanonicalGameRecord,
  envelope: { session: string; env: 'dev' | 'prod'; appVersion: string; playerKey?: string; emittedAt?: string },
): CanonicalRecordRow | null {
  if (!isPrivacySafeRecord(record)) return null;
  try {
    const payload = JSON.stringify(record);
    if (Buffer.byteLength(payload) > MAX_RECORD_BYTES) return null;
    const hand = record.recordType === 'poker_hand' ? record : null;
    // Tag the envelope with the player key only when a human actually played — an
    // AI-vs-AI game the user merely ran is not "their" gameplay.
    const hasHuman = record.participants.some((p) => p.kind === 'human');
    return {
      emittedAt: envelope.emittedAt ?? new Date().toISOString(),
      sessionId: envelope.session,
      playerKey: hasHuman ? (envelope.playerKey ?? '') : '',
      environment: envelope.env,
      appVersion: envelope.appVersion,
      recordType: record.recordType,
      recordSchemaVersion: record.recordSchemaVersion,
      recordId: record.recordId,
      recordRevision: record.revision,
      matchId: record.matchId,
      handId: hand?.handId ?? '',
      handNumber: hand?.handNumber ?? 0,
      game: record.game,
      rulesVersion: record.rulesVersion,
      status: record.status,
      endReason: record.endReason ?? '',
      startedAt: record.startedAt,
      // Omitted (not a sentinel) when the game hasn't ended: JSON.stringify drops the
      // undefined, and a missing field takes the column DEFAULT — it can never quarantine.
      endedAt: record.endedAt,
      participantCount: record.participants.length,
      actionCount: record.actions.length,
      payloadJson: payload,
    };
  } catch {
    return null;
  }
}
