import { randomUUID } from 'node:crypto';
import type { ActionChoice, DecisionDiagnostics as AiDecisionDiagnostics, Player } from '../../ai/player.ts';
import type { ChessState, ChessResult } from '../../rules/chess/chess.ts';
import { moveToUci } from '../../rules/chess/san.ts';
import {
  BLACK,
  FLAG_CAPTURE,
  FLAG_CASTLE_K,
  FLAG_CASTLE_Q,
  FLAG_DOUBLE,
  FLAG_EP,
  FLAG_PROMO,
  PIECE_CHARS,
  pieceColor,
  pieceType,
  squareToAlg,
  WHITE,
  type Move,
} from '../../rules/chess/types.ts';
import { cardLabel } from '../../rules/poker/cards.ts';
import type { PokerAction, PokerRulesHandRecord } from '../../rules/poker/holdem.ts';
import {
  RECORD_SCHEMA_VERSION,
  type CanonicalAction,
  type ChessAppliedAction,
  type ChessMatchRecord,
  type ControllerAssignment,
  type DecisionDiagnostics,
  type ParticipantResult,
  type PokerAppliedAction,
  type PokerHandRecord,
  type PokerMatchRecord,
  type PokerRequestedAction,
  type RecordEndReason,
  type RecordParticipant,
} from '../../telemetry/records.ts';

export type RecorderController =
  | { kind: 'human' }
  | { kind: 'model'; model: string; runtime?: 'text' | 'realtime' };

const now = (): string => new Date().toISOString();
const id = (): string => randomUUID();
// Persist a recoverable chess revision every five full moves. Normal completion,
// navigation, and quit still emit immediately; this only bounds hard-crash loss.
export const CHESS_CHECKPOINT_INTERVAL_PLIES = 10;

function sameController(a: ControllerAssignment, b: RecorderController): boolean {
  return a.controllerKind === b.kind &&
    (b.kind === 'human' || (a.requestedModel === b.model && a.runtime === b.runtime));
}

class ControllerTimeline {
  readonly participants: RecordParticipant[];
  private readonly assignments: ControllerAssignment[] = [];
  private readonly active = new Map<number, ControllerAssignment>();

  constructor(roles: string[], initial: RecorderController[], private readonly playerKey = '') {
    this.participants = roles.map((role, seat) => ({ participantId: id(), kind: initial[seat].kind, role }));
    for (let seat = 0; seat < roles.length; seat++) this.open(seat, initial[seat], 1);
  }

  participant(seat: number): RecordParticipant {
    const participant = this.participants[seat];
    if (!participant) throw new Error(`recording: missing participant for seat ${seat}`);
    return participant;
  }

  assignmentFor(seat: number, controller: RecorderController, actionSeq: number): ControllerAssignment {
    const current = this.active.get(seat);
    if (current && sameController(current, controller)) return current;
    if (current) current.endActionSeq = actionSeq;
    return this.open(seat, controller, actionSeq);
  }

  currentAssignment(seat: number): ControllerAssignment {
    const assignment = this.active.get(seat);
    if (!assignment) throw new Error(`recording: missing assignment for seat ${seat}`);
    return assignment;
  }

  snapshot(lastActionSeq: number): ControllerAssignment[] {
    return this.assignments.map((a) => ({ ...a, endActionSeq: a.endActionSeq ?? lastActionSeq + 1 }));
  }

  private open(seat: number, controller: RecorderController, startActionSeq: number): ControllerAssignment {
    const participant = this.participant(seat);
    const assignment: ControllerAssignment = {
      assignmentId: id(),
      participantId: participant.participantId,
      controllerKind: controller.kind,
      ...(controller.kind === 'model'
        ? {
            requestedModel: controller.model,
            ...(controller.runtime ? { runtime: controller.runtime } : {}),
          }
        : this.playerKey
          ? { playerKey: this.playerKey }
          : {}),
      startActionSeq,
    };
    this.assignments.push(assignment);
    this.active.set(seat, assignment);
    return assignment;
  }
}

function decisionFields(diagnostics: AiDecisionDiagnostics | undefined): DecisionDiagnostics {
  if (!diagnostics) return {};
  const attempts = diagnostics.attempts.map((a) => ({
    phase: a.phase,
    result: a.result,
    latencyMs: a.latencyMs,
    ...(a.rejectionReason ? { rejectionReason: a.rejectionReason } : {}),
    ...(a.failureKind ? { failureKind: a.failureKind } : {}),
    ...(a.inputTokens !== undefined ? { inputTokens: a.inputTokens } : {}),
    ...(a.outputTokens !== undefined ? { outputTokens: a.outputTokens } : {}),
  }));
  return {
    latencyMs: diagnostics.durationMs,
    attemptCount: attempts.length,
    illegalAttemptCount: attempts.filter((a) => a.rejectionReason === 'illegal').length,
    providerErrorCount: attempts.filter((a) => a.result === 'error').length,
    normalized: diagnostics.resolution === 'normalized',
    randomFallback: diagnostics.resolution === 'random-fallback',
    resolution: diagnostics.resolution,
    attempts,
    ...(diagnostics.fallbackReason ? { fallbackReason: diagnostics.fallbackReason } : {}),
  };
}

function playerController<A>(
  player: Player<A>,
  human: boolean,
  runtime?: 'text' | 'realtime',
  requestedModel?: string,
): RecorderController {
  return human ? { kind: 'human' } : { kind: 'model', model: requestedModel ?? player.name, runtime };
}

function moveFlags(move: Move): string[] {
  const flags: string[] = [];
  if (move.flags & FLAG_CAPTURE) flags.push('capture');
  if (move.flags & FLAG_EP) flags.push('en-passant');
  if (move.flags & FLAG_CASTLE_K) flags.push('castle-kingside');
  if (move.flags & FLAG_CASTLE_Q) flags.push('castle-queenside');
  if (move.flags & FLAG_DOUBLE) flags.push('double-pawn');
  if (move.flags & FLAG_PROMO) flags.push('promotion');
  return flags;
}

function pieceName(encoded: number): string | undefined {
  if (!encoded) return undefined;
  const color = pieceColor(encoded) === WHITE ? 'white' : 'black';
  return `${color}-${PIECE_CHARS[pieceType(encoded)]}`;
}

export class ChessGameRecorder {
  readonly matchId = id();
  private readonly recordId = id();
  private readonly startedAt = now();
  private readonly timeline: ControllerTimeline;
  private readonly actions: Array<CanonicalAction<ChessAppliedAction>> = [];
  private pending: {
    base: Omit<CanonicalAction<ChessAppliedAction>, 'applied'>;
    applied: Omit<ChessAppliedAction, 'san' | 'legal' | 'fenAfter'>;
  } | null = null;
  private emitted = false;
  private illegalModeUsed: boolean;

  constructor(
    private readonly mode: 'ai_vs_ai' | 'human_vs_ai' | 'hotseat',
    initial: RecorderController[],
    private readonly initialFen: string,
    allowIllegalMoves: boolean,
    playerKey = '',
  ) {
    this.timeline = new ControllerTimeline(['white', 'black'], initial, playerKey);
    this.illegalModeUsed = allowIllegalMoves;
  }

  actionChosen(
    seat: number,
    player: Player<Move>,
    choice: ActionChoice<Move>,
    state: ChessState,
    human: boolean,
    illegalMode: boolean,
  ): void {
    const seq = this.actions.length + 1;
    const participant = this.timeline.participant(seat);
    const assignment = this.timeline.assignmentFor(seat, playerController(player, human), seq);
    const move = choice.action;
    this.illegalModeUsed ||= illegalMode;
    this.pending = {
      base: {
        actionId: id(),
        seq,
        participantId: participant.participantId,
        assignmentId: assignment.assignmentId,
        phase: `ply-${seq}`,
        ...decisionFields(choice.diagnostics),
      },
      applied: {
        uci: moveToUci(move),
        ...(this.illegalModeUsed ? { fenBefore: state.fen() } : {}),
        from: squareToAlg(move.from),
        to: squareToAlg(move.to),
        movingPiece: pieceName(move.piece) ?? 'unknown',
        ...(pieceName(move.captured) ? { capturedPiece: pieceName(move.captured) } : {}),
        ...(move.promotion ? { promotion: PIECE_CHARS[move.promotion] } : {}),
        flags: moveFlags(move),
      },
    };
  }

  actionApplied(state: ChessState, san: string, illegal: boolean): void {
    if (!this.pending) return;
    this.actions.push({
      ...this.pending.base,
      applied: {
        ...this.pending.applied,
        san,
        legal: !illegal,
        ...(this.illegalModeUsed ? { fenAfter: state.fen() } : {}),
      },
    });
    this.pending = null;
  }

  checkpoint(endingFen: string): ChessMatchRecord | null {
    if (
      this.emitted ||
      this.actions.length === 0 ||
      this.actions.length % CHESS_CHECKPOINT_INTERVAL_PLIES !== 0
    ) return null;
    return this.build(
      'in_progress',
      undefined,
      endingFen,
      undefined,
      this.timeline.participants.map((p) => ({ participantId: p.participantId, result: 'unranked' })),
    );
  }

  completed(result: ChessResult, endingFen: string): ChessMatchRecord | null {
    if (this.emitted) return null;
    this.emitted = true;
    const winner = result.winner;
    return this.build(
      'completed',
      'natural',
      endingFen,
      result.reason,
      this.timeline.participants.map((p, seat): ParticipantResult => ({
        participantId: p.participantId,
        result: winner === null ? 'draw' : winner === seat ? 'win' : 'loss',
        utility: winner === null ? 0 : winner === seat ? 1 : -1,
      })),
    );
  }

  abandoned(reason: Exclude<RecordEndReason, 'natural'>, endingFen: string): ChessMatchRecord | null {
    if (this.emitted) return null;
    this.emitted = true;
    return this.build('abandoned', reason, endingFen, undefined, this.timeline.participants.map((p) => ({ participantId: p.participantId, result: 'unranked' })));
  }

  private build(
    status: 'in_progress' | 'completed' | 'abandoned',
    endReason: RecordEndReason | undefined,
    endingFen: string,
    resultReason: ChessMatchRecord['details']['resultReason'],
    results: ParticipantResult[],
  ): ChessMatchRecord {
    return {
      recordType: 'match',
      recordSchemaVersion: RECORD_SCHEMA_VERSION,
      recordId: this.recordId,
      revision: this.actions.length + (status === 'in_progress' ? 0 : 1),
      matchId: this.matchId,
      game: 'chess',
      rulesVersion: 'chess-1',
      status,
      ...(endReason ? { endReason } : {}),
      startedAt: this.startedAt,
      ...(status === 'in_progress' ? {} : { endedAt: now() }),
      lastActionSeq: this.actions.length,
      participants: this.timeline.participants.map((p) => ({ ...p })),
      controllerAssignments: this.timeline.snapshot(this.actions.length),
      actions: this.actions.map((a) => ({ ...a, applied: { ...a.applied }, attempts: a.attempts?.map((x) => ({ ...x })) })),
      results,
      details: {
        mode: this.mode,
        initialFen: this.initialFen,
        allowIllegalMoves: this.illegalModeUsed,
        ...(resultReason ? { resultReason } : {}),
        endingFen,
      },
    };
  }
}

interface PokerActionActor {
  participantId: string;
  assignmentId: string;
  diagnostics: DecisionDiagnostics;
}

function requestedPokerAction(action: PokerAction): PokerRequestedAction {
  switch (action.type) {
    case 'bet': return { kind: 'bet', amount: action.amount };
    case 'raise': return { kind: 'raise', amountTo: action.to };
    default: return { kind: action.type };
  }
}

export class PokerSessionRecorder {
  readonly matchId = id();
  private readonly recordId = id();
  private readonly startedAt = now();
  private readonly timeline: ControllerTimeline;
  private readonly initialStacks: number[];
  private globalActionSeq = 0;
  private handNumber = 0;
  private completedHands = 0;
  private handStartedAt = '';
  private handId = '';
  private handStartGlobalSeq = 0;
  private handActors: PokerActionActor[] = [];
  private eliminatedAt = new Map<number, number>();
  private emitted = false;

  constructor(
    private readonly mode: 'ai_table' | 'human_table' | 'mixed',
    initial: RecorderController[],
    stacks: number[],
    private readonly smallBlind: number,
    private readonly bigBlind: number,
    playerKey = '',
  ) {
    this.timeline = new ControllerTimeline(initial.map((_, seat) => `seat-${seat}`), initial, playerKey);
    this.initialStacks = stacks.slice();
  }

  beginHand(): void {
    this.handNumber++;
    this.handStartedAt = now();
    this.handId = id();
    this.handStartGlobalSeq = this.globalActionSeq;
    this.handActors = [];
  }

  actionChosen(
    seat: number,
    player: Player<PokerAction>,
    choice: ActionChoice<PokerAction>,
    human: boolean,
    runtime?: 'text' | 'realtime',
    requestedModel?: string,
  ): void {
    const nextGlobal = this.globalActionSeq + 1;
    const participant = this.timeline.participant(seat);
    const assignment = this.timeline.assignmentFor(
      seat,
      playerController(player, human, runtime, requestedModel),
      nextGlobal,
    );
    this.handActors.push({ participantId: participant.participantId, assignmentId: assignment.assignmentId, diagnostics: decisionFields(choice.diagnostics) });
  }

  actionApplied(): void {
    this.globalActionSeq++;
  }

  finishHand(
    rules: PokerRulesHandRecord,
    completed: boolean,
    abandonedReason: Exclude<RecordEndReason, 'natural'> = 'user_stopped',
  ): PokerHandRecord {
    if (completed) {
      this.completedHands++;
      for (const result of rules.results) {
        if (rules.startingStacks[result.seat] > 0 && rules.endingStacks[result.seat] === 0 && !this.eliminatedAt.has(result.seat)) {
          this.eliminatedAt.set(result.seat, this.completedHands);
        }
      }
    }
    const participants = this.timeline.participants;
    const actions = rules.actions.map((action, index): CanonicalAction<PokerAppliedAction, PokerRequestedAction> => {
      const actor = this.handActors[index];
      const participant = participants[action.seat];
      const fallbackAssignment = this.timeline.currentAssignment(action.seat);
      return {
        actionId: id(),
        seq: this.handStartGlobalSeq + action.actionNo,
        participantId: actor?.participantId ?? participant.participantId,
        assignmentId: actor?.assignmentId ?? fallbackAssignment.assignmentId,
        phase: action.street,
        requested: requestedPokerAction(action.requested),
        applied: {
          kind: action.effective.type,
          allIn: action.effective.allIn,
          adjusted: action.adjusted,
          amountTo: action.effective.streetCommitmentAfter,
          amountAdded: action.effective.amountCommitted,
          potBefore: action.potBefore,
          stackBefore: action.stackBefore,
          toCallBefore: action.toCallBefore,
        },
        ...(actor?.diagnostics ?? {}),
      };
    });
    const cards = [
      ...rules.holeCards.flatMap((hole) => hole.cards.map((card) => ({
        card: cardLabel(card),
        dealtToParticipantId: participants[hole.seat].participantId,
        dealtAtActionSeq: 0,
        disposition: hole.disposition,
        ...(hole.publicAtActionNo !== undefined ? { publicAtActionSeq: this.handStartGlobalSeq + hole.publicAtActionNo } : {}),
      }))),
      ...rules.board.flatMap((reveal) => reveal.cards.map((card) => ({
        card: cardLabel(card),
        disposition: 'public' as const,
        dealtAtActionSeq: this.handStartGlobalSeq + reveal.publicAfterActionNo,
        publicAtActionSeq: this.handStartGlobalSeq + reveal.publicAfterActionNo,
      }))),
    ];
    return {
      recordType: 'poker_hand',
      recordSchemaVersion: RECORD_SCHEMA_VERSION,
      recordId: id(),
      revision: 1,
      matchId: this.matchId,
      handId: this.handId,
      handNumber: this.handNumber,
      game: 'poker',
      rulesVersion: 'holdem-1',
      status: completed ? 'completed' : 'abandoned',
      endReason: completed ? 'natural' : abandonedReason,
      startedAt: this.handStartedAt,
      endedAt: now(),
      lastActionSeq: this.globalActionSeq,
      participants: participants.map((p) => ({ ...p })),
      controllerAssignments: this.timeline.snapshot(this.globalActionSeq).filter((a) =>
        a.startActionSeq <= this.globalActionSeq && (a.endActionSeq ?? Infinity) > this.handStartGlobalSeq,
      ),
      buttonParticipantId: participants[rules.button].participantId,
      smallBlindParticipantId: participants[rules.smallBlindSeat].participantId,
      bigBlindParticipantId: participants[rules.bigBlindSeat].participantId,
      smallBlind: rules.smallBlind,
      bigBlind: rules.bigBlind,
      finalStreet: rules.finalStreet,
      cards,
      actions,
      awards: rules.awards.map((award) => ({
        participantId: participants[award.seat].participantId,
        amount: award.amount,
        potIndex: award.potIndex,
      })),
      results: rules.results.map((r) => ({
        participantId: participants[r.seat].participantId,
        dealtIn: r.dealtIn,
        startingStack: rules.startingStacks[r.seat],
        endingStack: rules.endingStacks[r.seat],
        committed: r.committed,
        awarded: r.awarded,
        netChips: r.net,
        folded: r.folded,
        reachedShowdown: r.reachedShowdown,
        wonAnyPot: r.awarded > 0,
      })),
    };
  }

  finishMatch(finalStacks: number[], completed: boolean, reason: RecordEndReason): PokerMatchRecord | null {
    if (this.emitted) return null;
    this.emitted = true;
    const winners = completed ? new Set(finalStacks.flatMap((stack, seat) => stack > 0 ? [seat] : [])) : new Set<number>();
    const eliminationGroups = [...new Set(this.eliminatedAt.values())].sort((a, b) => b - a);
    const results: ParticipantResult[] = this.timeline.participants.map((participant, seat) => {
      if (!completed) return { participantId: participant.participantId, result: 'unranked', score: finalStacks[seat] };
      if (winners.has(seat)) return { participantId: participant.participantId, result: 'win', rank: 1, placementMin: 1, placementMax: 1, score: finalStacks[seat] };
      const group = this.eliminatedAt.get(seat);
      const betterBefore = eliminationGroups.filter((g) => g > (group ?? -1)).reduce((n, g) => n + [...this.eliminatedAt.values()].filter((x) => x === g).length, winners.size);
      const tied = [...this.eliminatedAt.values()].filter((x) => x === group).length || 1;
      return {
        participantId: participant.participantId,
        result: 'loss',
        placementMin: betterBefore + 1,
        placementMax: betterBefore + tied,
        ...(tied === 1 ? { rank: betterBefore + 1 } : {}),
        score: finalStacks[seat],
      };
    });
    return {
      recordType: 'match',
      recordSchemaVersion: RECORD_SCHEMA_VERSION,
      recordId: this.recordId,
      revision: this.completedHands + 1,
      matchId: this.matchId,
      game: 'poker',
      rulesVersion: 'holdem-1',
      status: completed ? 'completed' : 'abandoned',
      endReason: reason,
      startedAt: this.startedAt,
      endedAt: now(),
      lastActionSeq: this.globalActionSeq,
      participants: this.timeline.participants.map((p) => ({ ...p })),
      controllerAssignments: this.timeline.snapshot(this.globalActionSeq),
      actions: [],
      results,
      details: {
        mode: this.mode,
        tableSize: this.initialStacks.length,
        smallBlind: this.smallBlind,
        bigBlind: this.bigBlind,
        startingStacks: this.initialStacks.slice(),
        finalStacks: finalStacks.slice(),
        handCount: this.completedHands,
        lastCompletedHandNumber: this.completedHands,
        eliminationOrder: [...this.eliminatedAt.entries()].sort((a, b) => a[1] - b[1]).map(([seat]) => this.timeline.participant(seat).participantId),
      },
    };
  }

  checkpointMatch(currentStacks: number[]): PokerMatchRecord | null {
    if (this.emitted || this.completedHands === 0) return null;
    return {
      recordType: 'match',
      recordSchemaVersion: RECORD_SCHEMA_VERSION,
      recordId: this.recordId,
      revision: this.completedHands,
      matchId: this.matchId,
      game: 'poker',
      rulesVersion: 'holdem-1',
      status: 'in_progress',
      startedAt: this.startedAt,
      lastActionSeq: this.globalActionSeq,
      participants: this.timeline.participants.map((p) => ({ ...p })),
      controllerAssignments: this.timeline.snapshot(this.globalActionSeq),
      actions: [],
      results: this.timeline.participants.map((p, seat) => ({ participantId: p.participantId, result: 'unranked', score: currentStacks[seat] })),
      details: {
        mode: this.mode,
        tableSize: this.initialStacks.length,
        smallBlind: this.smallBlind,
        bigBlind: this.bigBlind,
        startingStacks: this.initialStacks.slice(),
        finalStacks: currentStacks.slice(),
        handCount: this.completedHands,
        lastCompletedHandNumber: this.completedHands,
        eliminationOrder: [...this.eliminatedAt.entries()].sort((a, b) => a[1] - b[1]).map(([seat]) => this.timeline.participant(seat).participantId),
      },
    };
  }
}
