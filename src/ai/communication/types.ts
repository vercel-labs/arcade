export type CommunicationMode = 'autoreply' | 'ambient';

export type CommunicationIntent =
  | 'reply'
  | 'negotiate'
  | 'explain_strategy'
  | 'table_politics'
  | 'react'
  | 'banter'
  | 'monologue';

export type Communication =
  | { mode: 'silent'; intent: 'none'; privateReason?: string }
  | {
      mode: 'speak';
      intent: CommunicationIntent;
      text: string;
      privateReason?: string;
      respondsTo?: string;
      addressedSeats?: number[];
    };

export type CommunicationSpeaker =
  | { kind: 'human'; seat: number }
  | { kind: 'model'; seat: number };

export interface PublicConversationMessage {
  id: string;
  sequence: number;
  speaker: CommunicationSpeaker;
  speakerLabel: string;
  text: string;
  addressedSeats: number[];
}

export interface CommunicationDecision {
  communication: Communication;
  proposed: Communication;
  score: number;
  threshold: number;
  requiredResponse: boolean;
  reason: string;
  components?: Record<string, number>;
}
