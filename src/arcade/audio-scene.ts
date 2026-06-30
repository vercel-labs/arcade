import {
  type Camera,
  cameraMatrices,
  type RenderTarget,
  type RGB,
  STYLE_BOLD,
  STYLE_DIM,
  type Surface,
} from '../engine/index.ts';
import { OrbitCamera } from './orbit.ts';
import { loadWisp, mulberry32, providerTint, type Wisp } from './wisp.ts';
import {
  AudioPlayer,
  StreamPlayer,
  MicCapture,
  micAvailable,
  AudioLog,
  AecSidecar,
  openRealtime,
  type RealtimeHandlers,
  type RealtimeSession,
  type RealtimeSessionConfig,
  type RealtimeStatus,
} from '../voice/index.ts';
import type { KeyEvent } from '../platform/input.ts';

// The realtime audio screen: a live, full-duplex voice conversation with a
// speech-to-speech model while its provider wisp pulses as it talks. When a mic
// recorder + streaming player are present, it auto-starts: you just talk, server
// VAD segments your turns, the model replies with streamed audio, and speaking
// over it (barge-in) cuts the reply off. Without a mic it degrades to type-to-talk
// with streamed (or, with only afplay, buffered) playback. The realtime plumbing
// lives in src/ai/{realtime-session,audio-in,audio-out}.ts.

// The gateway's realtime (speech-to-speech) models — GET /v1/models filtered to
// type:"realtime". Provider = id.split('/')[0], which drives the wisp logo/tint.
const REALTIME_MODELS = [
  'openai/gpt-realtime-2',
  'openai/gpt-realtime-1.5',
  'openai/gpt-realtime-mini',
  'xai/grok-voice-think-fast-1.0',
];

const FOVY = (50 * Math.PI) / 180;
const RATE = 24000; // PCM16 sample rate shared by input + output audio
const PANEL_BG: RGB = [12, 14, 20];

// Hands-free echo gate (values from OpenAI's Codex CLI, tunable): while the model's
// audio is playing, drop mic chunks whose peak amplitude is below BARGE_PEAK (likely
// speaker echo); a louder chunk is treated as real speech and opens a GRACE_MS window
// during which all mic audio is forwarded so a barge-in (and its quieter syllables)
// reaches the server's VAD intact.
const BARGE_PEAK = 4000; // peak |int16| (0–32767) that counts as intentional speech
const GRACE_MS = 900; // keep forwarding this long after a loud chunk

export class AudioScene {
  private cam: OrbitCamera;
  private rng = mulberry32(0xa0d10);
  private modelIndex = 0;
  private wisp: Wisp;
  private wispProvider = '';
  private lastT = -1;

  private active = false;
  private session: RealtimeSession | null = null;
  private sessionModel = '';
  private connecting = false;

  // Output: stream when ffplay/sox is present (low-latency, barge-in-able),
  // otherwise buffer-and-play whole replies with afplay.
  private streamPlayer = new StreamPlayer();
  private bufferPlayer = new AudioPlayer();
  private mic = new MicCapture();
  private micStarted = false;
  private audioLog = new AudioLog(); // hands-free diagnostic timeline (→ .audio-logs/)
  // macOS VoiceProcessingIO sidecar: when available it replaces both the mic (sox)
  // and the playback (node-speaker) with one OS-AEC unit, so the model never hears
  // its own speaker output. Falls back to sox + node-speaker when unavailable.
  private aec = new AecSidecar();
  private useAec = false;

  private streaming = false; // streamed output available
  private duplex = false; // mic + streaming + key → voice conversation
  // 'ptt': space-toggle opens the mic (echo-proof, the default + speaker-safe fallback).
  // 'handsFree': mic streams continuously, server VAD drives turns, and a playback-aware
  // echo gate (Codex-style) keeps the model's own speaker output out of its VAD so it
  // doesn't interrupt itself. Toggle with ctrl+v.
  private mode: 'ptt' | 'handsFree' = 'ptt';
  private listening = false; // push-to-talk mic is open (space toggles it)
  private sentWhileOpen = false; // any mic audio forwarded since the mic opened
  private bargeUntil = 0; // hands-free: forward all mic audio until this time (barge-in grace)

  private input = ''; // the user's in-progress typed line
  private transcript = ''; // the model's latest spoken-reply transcript
  private userTranscript = ''; // transcription of what the user said (duplex)
  private status: RealtimeStatus | 'idle' = 'idle';
  private note = ''; // a transient status / error / hint line

  constructor() {
    this.wisp = this.loadProviderWisp();
    this.cam = new OrbitCamera({ azimuth: 0.4, elevation: 0.12, distance: 4.2, target: { x: 0, y: 0, z: 0 } }, 2, 30);
  }

  private get modelId(): string {
    return REALTIME_MODELS[this.modelIndex];
  }
  private get provider(): string {
    return this.modelId.split('/')[0] ?? this.modelId;
  }

  private loadProviderWisp(): Wisp {
    this.wispProvider = this.provider;
    try {
      return loadWisp(`public/assets/logos/${this.provider}.png`, providerTint(this.provider), 0, this.rng);
    } catch {
      return loadWisp('public/assets/logos/openai.png', providerTint('openai'), 0, this.rng);
    }
  }

  // ── lifecycle ────────────────────────────────────────────────────────────────
  activate(): void {
    this.active = true;
    this.input = '';
    this.transcript = '';
    this.userTranscript = '';
    this.status = 'idle';
    this.streaming = this.streamPlayer.available();
    this.useAec = this.aec.available(); // macOS VPIO sidecar owns mic + playback when present
    // With the AEC sidecar, voice works regardless of sox/node-speaker (it provides
    // both); otherwise we need a streaming player + a mic recorder.
    this.duplex = (this.useAec || (this.streaming && micAvailable())) && !!process.env.AI_GATEWAY_API_KEY;
    // Default to hands-free when AEC is available (its whole point is speakers); else
    // push-to-talk. Explicit ARCADE_VOICE_MODE overrides.
    this.mode =
      process.env.ARCADE_VOICE_MODE === 'handsfree'
        ? 'handsFree'
        : process.env.ARCADE_VOICE_MODE === 'ptt'
          ? 'ptt'
          : this.useAec
            ? 'handsFree'
            : 'ptt';
    if (!process.env.AI_GATEWAY_API_KEY) {
      this.note = 'sign in to Vercel to talk — press s on the menu';
    } else if (this.duplex) {
      this.note = this.useAec ? 'echo cancellation on' : '';
      void this.ensureSession(); // open the session + start the mic
    } else if (this.streaming) {
      this.note = 'no microphone found — type a message and press enter';
    } else {
      this.note = 'install ffplay or sox for streaming voice — type to send text';
    }
  }

  deactivate(): void {
    this.active = false;
    this.closeSession();
  }

  isActive(): boolean {
    return this.active;
  }

  private closeSession(): void {
    const logPath = this.audioLog.flush(); // write the hands-free timeline, if any
    if (logPath) this.note = `audio log → ${logPath}`;
    this.mic.stop();
    this.aec.stop();
    this.micStarted = false;
    this.streamPlayer.interrupt();
    this.session?.close();
    this.session = null;
    this.sessionModel = '';
    this.connecting = false;
    this.listening = false;
    this.bargeUntil = 0;
    this.wisp.setSpeaking(false);
  }

  // ── camera passthrough ────────────────────────────────────────────────────────
  resetView(): void {
    this.cam.reset();
  }
  orbit(dx: number, dy: number): void {
    this.cam.orbit(dx, dy);
  }
  pan(dx: number, dy: number): void {
    this.cam.pan(dx, dy);
  }
  zoomBy(factor: number): void {
    this.cam.zoomBy(factor);
  }

  // Cycle to the next realtime model: reload its wisp, reconnect (re-arming the
  // mic in duplex mode) so the conversation continues with the new model.
  cycleModel(): void {
    this.modelIndex = (this.modelIndex + 1) % REALTIME_MODELS.length;
    if (this.provider !== this.wispProvider) this.wisp = this.loadProviderWisp();
    this.closeSession();
    this.transcript = '';
    this.userTranscript = '';
    this.note = `model: ${this.modelId}`;
    if (this.duplex) void this.ensureSession();
  }

  // Switch between push-to-talk and hands-free. Reconnect so the new turn-detection
  // config (disabled vs server VAD) takes effect, like cycleModel.
  private toggleVoiceMode(): void {
    this.mode = this.mode === 'ptt' ? 'handsFree' : 'ptt';
    this.closeSession();
    this.note = this.mode === 'handsFree' ? 'hands-free — just talk' : 'push-to-talk — space to talk';
    if (this.duplex) void this.ensureSession();
  }

  // ── input (type to talk; works alongside the mic) ─────────────────────────────
  handleKey(ev: KeyEvent): boolean {
    if (ev.ctrl && ev.name === 'v' && this.duplex) {
      this.toggleVoiceMode(); // ctrl+v: switch between push-to-talk and hands-free
      return true;
    }
    if (ev.ctrl || ev.meta) return false;
    if (ev.name === 'enter') {
      const text = this.input.trim();
      if (text) {
        this.input = '';
        void this.send(text);
      }
      return true;
    }
    if (ev.name === 'backspace') {
      this.input = this.input.slice(0, -1);
      return true;
    }
    if (ev.name === 'space') {
      // PTT: space toggles the mic. Hands-free / text: space is a literal space.
      if (this.duplex && this.mode === 'ptt') this.toggleMic();
      else this.input += ' ';
      return true;
    }
    if (ev.name === 'tab') {
      this.cycleModel();
      return true;
    }
    if (ev.raw && ev.raw.length === 1 && ev.raw >= ' ') {
      this.input += ev.raw;
      return true;
    }
    return false;
  }

  // A typed turn: ensure a session, then send the text (the reply streams back as
  // audio + transcript via the handlers).
  private async send(text: string): Promise<void> {
    if (!process.env.AI_GATEWAY_API_KEY) {
      this.note = 'sign in to Vercel to talk — press s on the menu';
      return;
    }
    this.transcript = '';
    await this.ensureSession();
    await this.session?.say(text);
  }

  // Open + configure a session for the current model if one isn't already live.
  private async ensureSession(): Promise<void> {
    if (this.session && this.sessionModel === this.modelId) return;
    this.closeSession();
    this.connecting = true;
    this.sessionModel = this.modelId;
    try {
      const session = await openRealtime(this.modelId, this.handlers());
      session.updateSession(this.sessionConfig());
      this.session = session;
      if (this.mode === 'handsFree') this.audioLog.begin(this.modelId); // start the diagnostic timeline
    } catch (err) {
      this.connecting = false;
      this.note = `connection failed: ${(err as Error).message}`;
      this.closeSession();
    }
  }

  // Audio formats + transcription. Turn detection depends on mode: push-to-talk
  // disables server VAD (the user drives turns via the space-toggle / enter), while
  // hands-free uses server VAD to auto-segment turns — the echo gate in startMic
  // keeps the model's own playback out of that VAD so it doesn't interrupt itself.
  private sessionConfig(): RealtimeSessionConfig {
    // OpenAI's server VAD is more trigger-happy on background noise than xAI's, so
    // give it a higher activation threshold (needs clearer speech); other providers
    // keep the default.
    const threshold = this.provider === 'openai' ? 0.99 : 0.5;
    return {
      outputModalities: ['audio'],
      inputAudioFormat: { type: 'audio/pcm', rate: RATE },
      outputAudioFormat: { type: 'audio/pcm', rate: RATE },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      turnDetection:
        this.mode === 'handsFree'
          ? { type: 'server-vad', threshold, silenceDurationMs: 600, prefixPaddingMs: 300 }
          : { type: 'disabled' },
    };
  }

  // Start the mic once the session is open and keep it running. With the AEC sidecar
  // it provides the (echo-cancelled) mic; otherwise sox does. Each captured chunk is
  // routed by `forwardMic`. The stream stays warm across turns either way.
  private startMic(): void {
    if (this.micStarted) return;
    this.micStarted = true;
    const onChunk = (pcm: Buffer): void => this.forwardMic(pcm);
    const onErr = (m: string): void => {
      this.note = `mic error: ${m}`;
    };
    if (this.useAec) this.aec.start(onChunk, onErr);
    else this.mic.start(onChunk, onErr);
  }

  // Decide whether a captured mic chunk goes to the model. Push-to-talk forwards only
  // while `listening`. Hands-free forwards continuously — but without AEC it runs the
  // software echo gate (gateChunk) to keep the model's own playback out of the VAD;
  // with AEC the mic is already clean, so it forwards directly.
  private forwardMic(pcm: Buffer): void {
    if (this.mode === 'handsFree') {
      if (this.useAec) this.session?.appendAudio(pcm);
      else this.gateChunk(pcm);
      return;
    }
    if (!this.listening) return;
    this.sentWhileOpen = true;
    this.session?.appendAudio(pcm);
  }

  // Hands-free echo gate. While the model's audio is playing, drop low-amplitude mic
  // chunks (its own output bleeding into the mic) so they never reach the server's
  // VAD; a loud chunk is real speech — forward it and open a grace window so the rest
  // of the barge-in reaches the model. When nothing is playing, forward everything and
  // let server VAD segment normally.
  private gateChunk(pcm: Buffer): void {
    if (!this.session) return;
    const playMs = this.streamPlayer.queuedMs();
    const peak = pcm16Peak(pcm);
    const now = Date.now();
    let decision: 'fwd' | 'fwd-barge' | 'fwd-grace' | 'drop-echo';
    if (playMs <= 0) {
      decision = 'fwd'; // nothing playing → normal listening
    } else if (peak >= BARGE_PEAK) {
      this.bargeUntil = now + GRACE_MS; // intentional speech → forward + open grace window
      decision = 'fwd-barge';
    } else if (now < this.bargeUntil) {
      decision = 'fwd-grace'; // within a barge-in → keep forwarding quieter syllables
    } else {
      decision = 'drop-echo'; // low amplitude while the model talks → treat as echo
    }
    this.audioLog.mic(peak, playMs, decision);
    if (decision !== 'drop-echo') this.session.appendAudio(pcm);
  }

  // Stop the model's voice immediately (barge-in / cleanup): flush the AEC sidecar's
  // playback ring, or kill the node-speaker stream when not using AEC.
  private stopPlayback(): void {
    if (this.useAec) this.aec.flushPlayback();
    else this.streamPlayer.interrupt();
  }

  // Spacebar toggle: open the mic (barging in over any current reply) or close it
  // and commit the captured audio as the user's turn.
  private toggleMic(): void {
    if (!this.session || this.connecting) return;
    if (!this.listening) {
      // Turning on: cut off any in-progress reply so the user can talk over it and
      // the model's voice never reaches the mic, then start a clean input buffer.
      if (this.wisp.speaking || this.status === 'responding') {
        this.stopPlayback();
        this.session.cancelResponse();
        this.wisp.setSpeaking(false);
      }
      this.session.clearInput();
      this.transcript = ''; // fresh exchange — don't pile onto the last reply
      this.userTranscript = '';
      this.sentWhileOpen = false;
      this.listening = true;
    } else {
      // Turning off: end the turn and ask for a reply, unless nothing was captured.
      this.listening = false;
      if (this.sentWhileOpen) this.session.commitAudioAndRespond();
    }
  }

  private handlers(): RealtimeHandlers {
    return {
      onStatus: (s) => {
        this.status = s;
        this.connecting = s === 'connecting';
        if (s === 'open' && this.duplex) this.startMic(); // begin streaming the mic once connected
        if (s === 'responding') this.wisp.setSpeaking(true);
        if (s === 'done') {
          this.audioLog.said(this.transcript);
          this.audioLog.event('response-done');
          if (this.useAec) {
            this.wisp.setSpeaking(false); // sidecar keeps playing its buffered tail
          } else if (!this.streaming) {
            this.bufferPlayer.flush(() => this.wisp.setSpeaking(false));
          } else {
            this.streamPlayer.endReply(); // flush tail + close device (stops underflow spam)
            this.wisp.setSpeaking(false);
          }
        }
      },
      // Hands-free: server VAD detected the user speaking. Because the echo gate keeps
      // the model's own playback out of the mic stream, this only fires on real speech,
      // so it's a genuine barge-in — stop our playback (the server cancels its own
      // response) and start a fresh transcript for the new exchange.
      onSpeechStarted: () => {
        this.audioLog.event('speech-started');
        if (this.mode !== 'handsFree') return;
        this.stopPlayback();
        this.wisp.setSpeaking(false);
        // Reset BOTH sides for the new exchange — otherwise the previous turn's
        // `you:` line lingers (stale) next to the new reply until a fresh
        // transcription arrives.
        this.transcript = '';
        this.userTranscript = '';
      },
      onSpeechStopped: () => {
        this.audioLog.event('speech-stopped');
      },
      onUserTranscript: (text) => {
        this.userTranscript = text;
        this.audioLog.heard(text); // what the server thought the user said
      },
      onTranscript: (delta) => {
        this.transcript += delta;
      },
      onAudio: (pcm) => {
        this.audioLog.out(pcm16Peak(pcm), (pcm.length / 2 / RATE) * 1000); // model's own output
        if (this.useAec) this.aec.write(pcm); // sidecar plays it (and uses it as the AEC reference)
        else if (this.streaming) this.streamPlayer.write(pcm);
        else this.bufferPlayer.push(pcm);
        this.wisp.setSpeaking(true);
      },
      onError: (m) => {
        this.note = m;
        this.wisp.setSpeaking(false);
      },
    };
  }

  // ── render ───────────────────────────────────────────────────────────────────
  renderScene(target: RenderTarget, t: number): void {
    target.clear(0, 0, 0);
    const W = target.width;
    const H = target.height;
    const dt = this.lastT < 0 ? 1 / 30 : Math.min(0.1, Math.max(0, t - this.lastT));
    this.lastT = t;
    const eye = this.cam.eye();
    const camera: Camera = { eye, target: this.cam.target, up: { x: 0, y: 1, z: 0 }, fovy: FOVY, near: 0.05, far: 200 };
    const { viewProjection: vp } = cameraMatrices(camera, W / H);
    const { right, up } = this.cam.basis();
    this.wisp.renderWorld(target, vp, right, up, { x: 0, y: 0, z: 0 }, W, H, t, dt);
  }

  // Conversation overlay, drawn over the composited frame (like the menu shelf).
  drawOverlay(surf: Surface, cols: number, rows: number): void {
    const pad = 2;
    const w = Math.max(0, cols - pad * 2);
    const state = this.connecting
      ? 'connecting…'
      : this.listening
        ? '● listening — space to send'
        : this.wisp.speaking
          ? 'speaking…'
          : this.status === 'responding'
            ? 'thinking…'
            : this.mode === 'handsFree' && this.duplex
              ? '● just talk'
              : this.note || 'ready';
    const modeTag = this.duplex
      ? `  ·  ${this.mode === 'handsFree' ? 'hands-free' : 'push-to-talk'}${this.useAec ? ' · aec' : ''}`
      : '';
    surf.drawText(pad, rows - 7, trunc(`${this.modelId}   ·   ${state}${modeTag}`, w), [150, 200, 180], PANEL_BG, STYLE_BOLD);
    if (this.userTranscript) surf.drawText(pad, rows - 6, trunc(`you: ${this.userTranscript}`, w), [180, 200, 224], PANEL_BG);
    if (this.transcript) surf.drawText(pad, rows - 5, trunc(this.transcript, w), [220, 224, 234], PANEL_BG);
    surf.drawText(pad, rows - 4, trunc(`› ${this.input}_`, w), [240, 244, 255], PANEL_BG, STYLE_BOLD);
    const talkHint = this.mode === 'handsFree' ? 'just talk' : 'space talk';
    const hint = this.duplex ? `${talkHint} · ctrl+v mode · tab model · esc back` : 'enter send · tab model · esc back';
    surf.drawText(Math.max(pad, cols - hint.length - pad), rows - 1, hint, [110, 116, 132], PANEL_BG, STYLE_DIM);
  }
}

// Keep the tail of a string (so a growing transcript/prompt shows the newest text)
// within `w` cells.
function trunc(s: string, w: number): string {
  return s.length <= w ? s : s.slice(s.length - w);
}

// Peak absolute amplitude (0–32767) of a PCM16 little-endian mono buffer. Scans with
// a stride for speed — enough to tell speaker echo (quiet) from intentional speech.
function pcm16Peak(buf: Buffer): number {
  let peak = 0;
  for (let i = 0; i + 1 < buf.length; i += 2 * 4) {
    // step 4 samples (8 bytes); reading every sample isn't needed for an envelope
    const s = buf.readInt16LE(i);
    const a = s < 0 ? -s : s;
    if (a > peak) peak = a;
  }
  return peak;
}
