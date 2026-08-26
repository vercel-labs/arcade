import type { Communication, CommunicationDecision, CommunicationMode } from './types.ts';

export interface CommunicationPolicyInput {
  mode: CommunicationMode;
  proposal: Communication;
  seat: number;
  actionNumber: number;
  actionSalience: number;
  requiredResponse: boolean;
}

export class CommunicationPolicy {
  private lastTableSpeechAction = -100;
  private lastSpeechBySeat = new Map<number, number>();
  private monologuesBySeat = new Map<number, number>();
  private lastTextBySeat = new Map<number, string>();

  reset(): void {
    this.lastTableSpeechAction = -100;
    this.lastSpeechBySeat.clear();
    this.monologuesBySeat.clear();
    this.lastTextBySeat.clear();
  }

  decide(input: CommunicationPolicyInput): CommunicationDecision {
    const threshold = 0.62;
    const { proposal } = input;
    if (proposal.mode === 'silent') {
      return { communication: proposal, proposed: proposal, score: 0, threshold, requiredResponse: input.requiredResponse, reason: 'model chose silence' };
    }
    if (input.mode === 'autoreply') return this.accept(input, 1, threshold, 'autoreply mode');

    const seatGap = input.actionNumber - (this.lastSpeechBySeat.get(input.seat) ?? -100);
    const tableGap = input.actionNumber - this.lastTableSpeechAction;
    const direct = input.requiredResponse || proposal.intent === 'reply';
    const intentBonus = proposal.intent === 'negotiate' || proposal.intent === 'table_politics'
      ? 0.18
      : proposal.intent === 'explain_strategy' || proposal.intent === 'react'
        ? 0.08
        : proposal.intent === 'banter'
          ? 0.04
          : 0;
    const silenceBonus = Math.min(0.18, Math.max(0, tableGap - 3) * 0.03) + Math.min(0.12, Math.max(0, seatGap - 5) * 0.02);
    const repetitionPenalty = tableGap <= 1 ? 0.2 : 0;
    const monologueCount = this.monologuesBySeat.get(input.seat) ?? 0;
    const monologuePenalty = proposal.intent === 'monologue' ? (monologueCount >= 2 || seatGap < 25 ? 0.75 : 0.2) : 0;
    const normalizedText = proposal.text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const duplicatePenalty = normalizedText && this.lastTextBySeat.get(input.seat) === normalizedText ? 0.55 : 0;
    const score = direct ? 1 : Math.max(0, Math.min(1, input.actionSalience + intentBonus + silenceBonus - repetitionPenalty - monologuePenalty - duplicatePenalty));
    const components = { actionSalience: input.actionSalience, intentBonus, silenceBonus, repetitionPenalty, monologuePenalty, duplicatePenalty };
    if (score < threshold) {
      const communication: Communication = { mode: 'silent', intent: 'none', privateReason: proposal.privateReason ?? 'host policy suppressed low-salience table talk' };
      return { communication, proposed: proposal, score, threshold, requiredResponse: input.requiredResponse, reason: 'below ambient threshold', components };
    }
    return this.accept(input, score, threshold, direct ? 'direct response' : 'ambient threshold met', components);
  }

  private accept(input: CommunicationPolicyInput, score: number, threshold: number, reason: string, components?: Record<string, number>): CommunicationDecision {
    const proposal = input.proposal;
    if (proposal.mode === 'speak') {
      this.lastTableSpeechAction = input.actionNumber;
      this.lastSpeechBySeat.set(input.seat, input.actionNumber);
      this.lastTextBySeat.set(input.seat, proposal.text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());
      if (proposal.intent === 'monologue') this.monologuesBySeat.set(input.seat, (this.monologuesBySeat.get(input.seat) ?? 0) + 1);
    }
    return { communication: proposal, proposed: proposal, score, threshold, requiredResponse: input.requiredResponse, reason, ...(components ? { components } : {}) };
  }
}
