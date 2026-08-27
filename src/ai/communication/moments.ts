import type { CommunicationIntent, PublicConversationMessage } from './types.ts';

export type MomentStrength = 'routine' | 'notable' | 'dramatic';
export type ResponseExpectation = 'optional' | 'encouraged' | 'required';

export interface GameMoment {
  id: string;
  game: string;
  type: string;
  actorSeat?: number;
  affectedSeats: number[];
  relevantSeats: number[];
  strength: MomentStrength;
  importance: number;
  publicSummary: string;
  publicFacts: string[];
  suggestedIntents: CommunicationIntent[];
  responseExpectation: ResponseExpectation;
  beatKey?: string;
}

export interface CommunicationOpportunity {
  seat: number;
  moment: GameMoment;
  expectation: ResponseExpectation;
  reason: string;
}

/** Pick one table-wide reaction beat when a single action creates several moments. */
export function primaryMoment(moments: readonly GameMoment[]): GameMoment | undefined {
  return moments.reduce<GameMoment | undefined>((best, moment) => {
    if (!best || moment.importance > best.importance) return moment;
    return best;
  }, undefined);
}

/** Select a small, deterministic reaction set instead of polling the whole table. */
export function reactionOpportunities(moment: GameMoment, max = 1): CommunicationOpportunity[] {
  const candidates = [...new Set([...moment.affectedSeats, ...moment.relevantSeats])]
    .filter((seat) => seat !== moment.actorSeat);
  return candidates.slice(0, max).map((seat) => ({
    seat,
    moment,
    expectation: moment.responseExpectation,
    reason: moment.affectedSeats.includes(seat) ? 'directly affected by the moment' : 'strategically relevant to the moment',
  }));
}

/** Turn an explicit public address into one bounded reply opportunity per target. */
export function directedReplyOpportunities(
  message: PublicConversationMessage,
  game: string,
  validSeats: number,
): CommunicationOpportunity[] {
  return message.addressedSeats
    .filter((seat) => seat >= 0 && seat < validSeats && seat !== message.speaker.seat)
    .map((seat) => {
      const moment: GameMoment = {
        id: `${game}-directed-${message.id}-${seat}`,
        game,
        type: 'direct_address',
        actorSeat: message.speaker.seat,
        affectedSeats: [seat],
        relevantSeats: [seat],
        strength: 'notable',
        importance: 1,
        publicSummary: `${message.speakerLabel} directly addressed this player: “${message.text}”`,
        publicFacts: [`Source message: ${message.id}.`],
        suggestedIntents: ['reply', 'negotiate', 'react', 'banter'],
        responseExpectation: 'required',
        beatKey: `direct-address:${message.id}:${seat}`,
      };
      return { seat, moment, expectation: 'required' as const, reason: `directly addressed in ${message.id}` };
    });
}
