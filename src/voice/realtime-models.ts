// Realtime speech-to-speech models exposed by AI Gateway. Keep this inventory in
// the reusable voice layer so every app surface presents the same choices.
export interface RealtimeModelInfo {
  id: string;
  name: string;
  creator: string;
  creatorName: string;
  // Only routable on early-access teams. This flag governs the offline fallback;
  // signed-in Arcade setup uses Gateway's team-aware model eligibility instead.
  earlyAccess?: boolean;
}

export const REALTIME_MODELS: readonly RealtimeModelInfo[] = [
  { id: 'openai/gpt-realtime-2', name: 'GPT Realtime 2', creator: 'openai', creatorName: 'OpenAI' },
  { id: 'openai/gpt-realtime-1.5', name: 'GPT Realtime 1.5', creator: 'openai', creatorName: 'OpenAI' },
  { id: 'openai/gpt-realtime-mini', name: 'GPT Realtime Mini', creator: 'openai', creatorName: 'OpenAI' },
  { id: 'spacexai/grok-voice-think-fast-1.0', name: 'Grok Voice Think Fast 1.0', creator: 'spacexai', creatorName: 'xAI', earlyAccess: true },
];

export const DEFAULT_REALTIME_MODEL_ID = REALTIME_MODELS[0].id;

// The realtime models to offer when a live team-aware catalog cannot be loaded.
// Early-access-only models stay out of that fallback unless explicitly unlocked.
export function availableRealtimeModels(includeEarlyAccess: boolean): readonly RealtimeModelInfo[] {
  return includeEarlyAccess ? REALTIME_MODELS : REALTIME_MODELS.filter((m) => !m.earlyAccess);
}
