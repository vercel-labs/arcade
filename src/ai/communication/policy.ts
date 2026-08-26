import type { Communication, CommunicationDecision, CommunicationMode } from './types.ts';

export interface CommunicationPolicyInput {
  mode: CommunicationMode;
  proposal: Communication;
  seat: number;
  actionNumber: number;
  actionSalience: number;
  requiredResponse: boolean;
}

interface RecentSpeech {
  actionNumber: number;
  normalizedText: string;
  signature: Set<string>;
}

const REPETITION_WINDOW = 20;
const MAX_RECENT_SPEECH = 8;
const SIMILARITY_THRESHOLD = 0.72;
const REPETITION_STOP_WORDS = new Set([
  'about', 'after', 'again', 'alright', 'also', 'anyone', 'because', 'before', 'could', 'from', 'give', 'have', 'here',
  'how', 'into', 'just', 'keep', 'like', 'make', 'need', 'now', 'offer', 'offering', 'okay', 'right', 'some', 'still',
  'take', 'that', 'then', 'there', 'they', 'this', 'those', 'want', 'what', 'when', 'will', 'with', 'would', 'your',
]);

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function wordSignature(normalizedText: string): Set<string> {
  return new Set(normalizedText.split(/\s+/).flatMap((word) => {
    if (!word || word.length < 3 || REPETITION_STOP_WORDS.has(word)) return [];
    const singular = word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word;
    return [singular];
  }));
}

function containmentSimilarity(a: Set<string>, b: Set<string>): number {
  const denominator = Math.min(a.size, b.size);
  if (denominator < 3) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  return shared / denominator;
}

export class CommunicationPolicy {
  private lastTableSpeechAction = -100;
  private lastSpeechBySeat = new Map<number, number>();
  private monologuesBySeat = new Map<number, number>();
  private recentSpeechBySeat = new Map<number, RecentSpeech[]>();

  reset(): void {
    this.lastTableSpeechAction = -100;
    this.lastSpeechBySeat.clear();
    this.monologuesBySeat.clear();
    this.recentSpeechBySeat.clear();
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
    const normalizedText = normalizeText(proposal.text);
    const signature = wordSignature(normalizedText);
    const duplicate = (this.recentSpeechBySeat.get(input.seat) ?? []).some((recent) =>
      input.actionNumber - recent.actionNumber <= REPETITION_WINDOW
      && (recent.normalizedText === normalizedText || containmentSimilarity(recent.signature, signature) >= SIMILARITY_THRESHOLD));
    const duplicatePenalty = duplicate ? 0.55 : 0;
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
      const normalizedText = normalizeText(proposal.text);
      const recent = this.recentSpeechBySeat.get(input.seat) ?? [];
      recent.push({ actionNumber: input.actionNumber, normalizedText, signature: wordSignature(normalizedText) });
      this.recentSpeechBySeat.set(input.seat, recent.slice(-MAX_RECENT_SPEECH));
      if (proposal.intent === 'monologue') this.monologuesBySeat.set(input.seat, (this.monologuesBySeat.get(input.seat) ?? 0) + 1);
    }
    return { communication: proposal, proposed: proposal, score, threshold, requiredResponse: input.requiredResponse, reason, ...(components ? { components } : {}) };
  }
}
