import { PublicConversation } from './conversation.ts';
import { CommunicationPolicy } from './policy.ts';
import type { Communication, CommunicationDecision, CommunicationMode, PublicConversationMessage } from './types.ts';

/** Shared actor-speech coordinator for games that do not need game-specific reaction windows. */
export class TableCommunicationCoordinator {
  private readonly conversation = new PublicConversation();
  private readonly policy = new CommunicationPolicy();
  private decisions = 0;
  private spoken = 0;
  private words = 0;

  constructor(
    private readonly mode: CommunicationMode,
    private readonly labels: readonly string[],
    private readonly guide: string,
  ) {}

  modelConfig(): { mode: () => CommunicationMode; guide: string } {
    return { mode: () => this.mode, guide: this.guide };
  }

  contextFor(seat: number): string {
    return this.conversation.promptFor(seat);
  }

  messages(): readonly PublicConversationMessage[] {
    return this.conversation.all();
  }

  decide(seat: number, proposal: Communication | undefined, actionNumber: number, actionSalience: number): CommunicationDecision {
    const requiredResponse = this.conversation.requiredResponseFor(seat) !== undefined;
    const proposed = proposal ?? { mode: 'silent', intent: 'none', privateReason: 'no structured communication returned' };
    const decision = this.policy.decide({ mode: this.mode, proposal: proposed, seat, actionNumber, actionSalience, requiredResponse });
    this.decisions++;
    if (decision.communication.mode === 'speak') {
      this.spoken++;
      this.words += decision.communication.text.trim().split(/\s+/).filter(Boolean).length;
      this.conversation.appendModel(seat, this.labels[seat] ?? `P${seat + 1}`, decision.communication.text, decision.communication.addressedSeats);
      this.conversation.consumeResponseFor(seat);
    }
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
}
