// Public API of the voice module: realtime speech-to-speech session over the AI
// Gateway, plus mic capture / speaker playback and OS-native echo cancellation.
// App code imports from here; modules inside the module import each other directly.
// Code that only needs the realtime WebSocket (tools/match-test.ts) imports
// ./realtime-session.ts directly so it never probes the audio devices.
// docs/voice.md covers the design, what ships, and what does not.
export { AudioPlayer, StreamPlayer, audioAvailable, toWav } from './audio-out.ts';
export { MicCapture, micAvailable } from './audio-in.ts';
export { AudioLog } from './audio-log.ts';
export { AecSidecar } from './aec-sidecar.ts';
export { AUDIO_RATE, pcm16Peak, VoiceDuplex, type VoiceDuplexHandlers, type VoiceMode } from './voice-duplex.ts';
export { availableRealtimeModels, DEFAULT_REALTIME_MODEL_ID, REALTIME_MODELS, type RealtimeModelInfo } from './realtime-models.ts';
export {
  openRealtime,
  RealtimeSession,
  type RealtimeHandlers,
  type RealtimeSessionConfig,
  type RealtimeStatus,
  type RealtimeSocket,
  type RealtimeCodec,
  type RealtimeToolDefinition,
} from './realtime-session.ts';
