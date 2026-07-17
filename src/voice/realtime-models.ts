// Realtime speech-to-speech models exposed by AI Gateway. Keep this inventory in
// the reusable voice layer so every app surface presents the same choices.
export interface RealtimeModelInfo {
  id: string;
  name: string;
  creator: string;
  creatorName: string;
}

export const REALTIME_MODELS: readonly RealtimeModelInfo[] = [
  { id: 'openai/gpt-realtime-2', name: 'GPT Realtime 2', creator: 'openai', creatorName: 'OpenAI' },
  { id: 'openai/gpt-realtime-1.5', name: 'GPT Realtime 1.5', creator: 'openai', creatorName: 'OpenAI' },
  { id: 'openai/gpt-realtime-mini', name: 'GPT Realtime Mini', creator: 'openai', creatorName: 'OpenAI' },
  { id: 'xai/grok-voice-think-fast-1.0', name: 'Grok Voice Think Fast 1.0', creator: 'xai', creatorName: 'xAI' },
];

export const DEFAULT_REALTIME_MODEL_ID = REALTIME_MODELS[0].id;
