// Realtime speech-to-speech models exposed by AI Gateway. Keep this inventory in
// the reusable voice layer so every app surface presents the same choices.
export interface RealtimeModelInfo {
  id: string;
  name: string;
  creator: string;
  creatorName: string;
  // Only routable on early-access teams. On other teams the gateway rejects the realtime
  // WebSocket upgrade with HTTP 400, so these are hidden from the picker unless early
  // access is unlocked (see availableRealtimeModels).
  earlyAccess?: boolean;
}

export const REALTIME_MODELS: readonly RealtimeModelInfo[] = [
  { id: 'openai/gpt-realtime-2', name: 'GPT Realtime 2', creator: 'openai', creatorName: 'OpenAI' },
  { id: 'openai/gpt-realtime-1.5', name: 'GPT Realtime 1.5', creator: 'openai', creatorName: 'OpenAI' },
  { id: 'openai/gpt-realtime-mini', name: 'GPT Realtime Mini', creator: 'openai', creatorName: 'OpenAI' },
  { id: 'xai/grok-voice-think-fast-1.0', name: 'Grok Voice Think Fast 1.0', creator: 'xai', creatorName: 'xAI', earlyAccess: true },
];

export const DEFAULT_REALTIME_MODEL_ID = REALTIME_MODELS[0].id;

// The realtime models to OFFER in a picker. Early-access-only models 400 at the WebSocket
// handshake on teams without access, so they're excluded unless early access is unlocked.
// Interim gate until a per-team availability signal (a /v1/models access check) exists.
export function availableRealtimeModels(includeEarlyAccess: boolean): readonly RealtimeModelInfo[] {
  return includeEarlyAccess ? REALTIME_MODELS : REALTIME_MODELS.filter((m) => !m.earlyAccess);
}
