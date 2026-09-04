import { PublicConversation } from './conversation.ts';
import type { CommunicationOpportunity } from './moments.ts';
import { CommunicationPolicy } from './policy.ts';
import type { Communication, CommunicationDecision, CommunicationMode, PublicConversationMessage } from './types.ts';

// Seat labels either as a fixed list or as a resolver, for tables that relabel seats
// mid-game (a chess side swapped to another model keeps the same conversation).
export type SeatLabels = readonly string[] | ((seat: number) => string | undefined);

export function seatLabel(labels: SeatLabels, seat: number, fallback: string): string {
  const label = typeof labels === 'function' ? labels(seat) : labels[seat];
  return label ?? fallback;
}

// Seats a message may address: real seats other than the speaker.
export function validTargets(seatCount: number, speakerSeat: number, addressedSeats: readonly number[] | undefined): number[] {
  return [...new Set((addressedSeats ?? []).filter((seat) => Number.isInteger(seat) && seat >= 0 && seat < seatCount && seat !== speakerSeat))];
}

// One bounded reply to a direct address. The reply is deliberately terminal: it may name
// somebody, but it cannot create another forced reply and turn one address into an
// endless loop. Shared by every coordinator so the rule cannot drift between games.
export function resolveDirectedReply(
  parts: { conversation: PublicConversation; policy: CommunicationPolicy; mode: CommunicationMode; labels: SeatLabels; seatCount: number },
  opportunity: CommunicationOpportunity,
  proposal: Communication | undefined,
  actionNumber: number,
): CommunicationDecision {
  const proposed = proposal ?? { mode: 'silent', intent: 'none', privateReason: 'declined the directed reply opportunity' };
  const decision = parts.policy.decide({
    mode: parts.mode,
    proposal: proposed,
    seat: opportunity.seat,
    actionNumber,
    actionSalience: 1,
    requiredResponse: true,
  });
  if (decision.communication.mode === 'speak') {
    parts.conversation.appendModel(
      opportunity.seat,
      seatLabel(parts.labels, opportunity.seat, `player ${opportunity.seat + 1}`),
      decision.communication.text,
      validTargets(parts.seatCount, opportunity.seat, decision.communication.addressedSeats),
      false,
    );
  }
  parts.conversation.consumeResponseFor(opportunity.seat);
  return decision;
}

/** Shared actor-speech coordinator for games that do not need game-specific reaction windows. */
export class TableCommunicationCoordinator {
  private readonly conversation = new PublicConversation();
  private readonly policy = new CommunicationPolicy();
  private decisions = 0;
  private spoken = 0;
  private words = 0;

  constructor(
    private readonly mode: CommunicationMode,
    private readonly labels: SeatLabels,
    private readonly guide: string,
    private readonly seatCount = typeof labels === 'function' ? Number.POSITIVE_INFINITY : labels.length,
  ) {}

  modelConfig(): { mode: () => CommunicationMode; guide: string } {
    return { mode: () => this.mode, guide: this.guide };
  }

  currentMode(): CommunicationMode {
    return this.mode;
  }

  contextFor(seat: number): string {
    return this.conversation.promptFor(seat);
  }

  messages(): readonly PublicConversationMessage[] {
    return this.conversation.all();
  }

  // What the human typed, addressed to the seats it names. Returns null for text that
  // sanitizes to nothing.
  addHuman(seat: number, text: string, addressedSeats: readonly number[] = []): PublicConversationMessage | null {
    return this.conversation.appendHuman(seat, seatLabel(this.labels, seat, 'the human player'), text, validTargets(this.seatCount, seat, addressedSeats));
  }

  // A line a seat said through some other channel (a move's rationale or table talk, a
  // practice bot's stock phrase), kept so a reply can refer back to it. It obliges nobody.
  noteSpeech(seat: number, text: string): void {
    this.conversation.appendModel(seat, seatLabel(this.labels, seat, `player ${seat + 1}`), text, [], false);
  }

  decide(seat: number, proposal: Communication | undefined, actionNumber: number, actionSalience: number): CommunicationDecision {
    const requiredResponse = this.conversation.requiredResponseFor(seat) !== undefined;
    const proposed = proposal ?? { mode: 'silent', intent: 'none', privateReason: 'no structured communication returned' };
    const decision = this.policy.decide({ mode: this.mode, proposal: proposed, seat, actionNumber, actionSalience, requiredResponse });
    this.count(decision);
    if (decision.communication.mode === 'speak') {
      this.conversation.appendModel(seat, seatLabel(this.labels, seat, `player ${seat + 1}`), decision.communication.text, validTargets(this.seatCount, seat, decision.communication.addressedSeats));
      this.conversation.consumeResponseFor(seat);
    }
    return decision;
  }

  decideDirectedReply(opportunity: CommunicationOpportunity, proposal: Communication | undefined, actionNumber: number): CommunicationDecision {
    const decision = resolveDirectedReply(
      { conversation: this.conversation, policy: this.policy, mode: this.mode, labels: this.labels, seatCount: this.seatCount },
      opportunity,
      proposal,
      actionNumber,
    );
    this.count(decision);
    return decision;
  }

  summary(): Record<string, number> {
    return {
      decisions: this.decisions,
      spoken: this.spoken,
      speechRate: this.decisions ? this.spoken / this.decisions : 0,
      averageWords: this.spoken ? this.words / this.spoken : 0,
    };
  }

  private count(decision: CommunicationDecision): void {
    this.decisions++;
    if (decision.communication.mode === 'speak') {
      this.spoken++;
      this.words += decision.communication.text.trim().split(/\s+/).filter(Boolean).length;
    }
  }
}
