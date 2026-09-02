// Canonical game records are deliberately narrower than arbitrary application events.
// There are no free-form prompt, reasoning, chat, voice, or error fields here: the
// record is the mechanical game state needed for replay, evaluation, or analytics.

export const RECORD_SCHEMA_VERSION = 1 as const;

export type RecordStatus = 'in_progress' | 'completed' | 'abandoned';
export type RecordEndReason =
  | 'natural'
  | 'user_stopped'
  | 'navigation'
  | 'action_limit'
  // Finalized while the process was exiting unexpectedly (uncaught error / crash); the
  // record is written to the durable outbox synchronously before exit.
  | 'process_exit_recovered';

export interface RecordParticipant {
  participantId: string;
  kind: 'human' | 'model';
  /** Stable match-local role: chess color, poker seat, Islanders color, etc. */
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
  blindLevels?: Array<{
    level: number;
    startsAtHand: number;
    smallBlind: number;
    bigBlind: number;
  }>;
  startingStacks: number[];
  finalStacks?: number[];
  handCount: number;
  lastCompletedHandNumber: number;
  /** Match-local participant ids in elimination order, earliest first. */
  eliminationOrder: string[];
}

export type PokerMatchRecord = MatchRecord<'poker', never, PokerMatchDetails>;

export interface IslandersAppliedAction {
  action: import('../rules/islanders/types.ts').IslandersAction;
  outcome?: import('../rules/islanders/islanders.ts').IslandersActionOutcome;
}

export interface IslandersMatchDetails {
  mode: 'ai_table' | 'human_table' | 'mixed';
  tableSize: number;
  domesticTrade: boolean;
  domesticTradeOfferLimit?: number;
  /** The initial world needed to replay recorded actions and their explicit chance outcomes. */
  replay: {
    board: import('../rules/islanders/setup.ts').BoardSetup;
    initialDevelopmentDeck: import('../rules/islanders/types.ts').DevCardType[];
  };
  finalVictoryPoints?: number[];
  longestRoadParticipantId?: string;
  largestArmyParticipantId?: string;
}

export type IslandersMatchRecord = MatchRecord<'islanders', IslandersAppliedAction, IslandersMatchDetails>;

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

export type CanonicalGameRecord = ChessMatchRecord | PokerMatchRecord | IslandersMatchRecord | PokerHandRecord;
