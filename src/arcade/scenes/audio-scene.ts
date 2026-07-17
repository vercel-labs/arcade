import {
  type Camera,
  cameraMatrices,
  type RenderTarget,
  type RGB,
  STYLE_BOLD,
  type Surface,
} from '../../engine/index.ts';
import { OrbitCamera } from '../orbit.ts';
import { loadCreatorWisp, mulberry32, type Wisp } from './wisp.ts';
import {
  AudioLog,
  AUDIO_RATE,
  openRealtime,
  REALTIME_MODELS,
  pcm16Peak,
  VoiceDuplex,
  type RealtimeHandlers,
  type RealtimeSession,
  type RealtimeSessionConfig,
  type RealtimeStatus,
} from '../../voice/index.ts';
import type { KeyEvent } from '../../platform/input.ts';

// The realtime audio screen: a live, full-duplex voice conversation with a
// speech-to-speech model while its creator wisp pulses as it talks. When a mic
// recorder + streaming player are present, it auto-starts: you just talk, server
// VAD segments your turns, the model replies with streamed audio, and speaking
// over it (barge-in) cuts the reply off. Without a mic it degrades to type-to-talk
// with streamed (or, with only afplay, buffered) playback. The realtime plumbing
// lives in src/voice/{realtime-session,audio-in,audio-out}.ts.

// The shared realtime-model inventory drives this scene's model cycle and wisp creator.
const FOVY = (50 * Math.PI) / 180;
const RATE = AUDIO_RATE; // PCM16 sample rate shared by input + output audio
const PANEL_BG: RGB = [12, 14, 20];

export class AudioScene {
  private cam: OrbitCamera;
  private rng = mulberry32(0xa0d10);
  private modelIndex = 0;
  private wisp: Wisp;
  private wispCreator = '';
  private lastT = -1;

  private active = false;
  private session: RealtimeSession | null = null;
  private sessionModel = '';
  private connecting = false;

  // The full-duplex audio bus (mic capture, echo gate, playback, AEC / node-speaker
  // selection). Mic chunks that clear the gate are forwarded to the session; the gate
  // decisions feed the diagnostic log. 'ptt' vs 'handsFree' lives inside it — toggle
  // with ctrl+v — as do the streaming/AEC capability flags (from probe).
  private audio = new VoiceDuplex({
    onForward: (pcm) => this.session?.appendAudio(pcm),
    onMicDecision: (peak, playMs, decision) => this.audioLog.mic(peak, playMs, decision),
    onError: (m) => {
      this.note = `mic error: ${m}`;
    },
  });
  private audioLog = new AudioLog(); // hands-free diagnostic timeline (→ .audio-logs/)
  private duplex = false; // mic + streaming + key → voice conversation

  private input = ''; // the user's in-progress typed line
  private transcript = ''; // the model's latest spoken-reply transcript
  private userTranscript = ''; // transcription of what the user said (duplex)
  private status: RealtimeStatus | 'idle' = 'idle';
  private note = ''; // a transient status / error / hint line

  constructor() {
    this.wisp = this.loadModelWisp();
    this.cam = new OrbitCamera({ azimuth: 0.4, elevation: 0.12, distance: 4.2, target: { x: 0, y: 0, z: 0 } }, 2, 30);
  }

  private get modelId(): string {
    return REALTIME_MODELS[this.modelIndex].id;
  }
  private get creator(): string {
    return this.modelId.split('/')[0] ?? this.modelId;
  }

  private loadModelWisp(): Wisp {
    this.wispCreator = this.creator;
    return loadCreatorWisp(this.creator, 0, this.rng);
  }

  // ── lifecycle ────────────────────────────────────────────────────────────────
  activate(): void {
    this.active = true;
    this.input = '';
    this.transcript = '';
    this.userTranscript = '';
    this.status = 'idle';
    // Probe I/O + pick the default mode (hands-free when the AEC sidecar is present).
    const cap = this.audio.probe(!!process.env.AI_GATEWAY_API_KEY);
    this.duplex = cap.duplex;
    if (!process.env.AI_GATEWAY_API_KEY) {
      this.note = 'sign in to Vercel to talk — press s on the menu';
    } else if (this.duplex) {
      this.note = this.audio.useAec ? 'echo cancellation on' : '';
      void this.ensureSession(); // open the session + start the mic
    } else if (cap.streaming) {
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
    this.audio.stop(); // stop the mic, drop buffered playback, reset turn state
    this.session?.close();
    this.session = null;
    this.sessionModel = '';
    this.connecting = false;
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
    if (this.creator !== this.wispCreator) this.wisp = this.loadModelWisp();
    this.closeSession();
    this.transcript = '';
    this.userTranscript = '';
    this.note = `model: ${this.modelId}`;
    if (this.duplex) void this.ensureSession();
  }

  // Switch between push-to-talk and hands-free. Reconnect so the new turn-detection
  // config (disabled vs server VAD) takes effect, like cycleModel.
  private toggleVoiceMode(): void {
    const mode = this.audio.toggleMode();
    this.closeSession();
    this.note = mode === 'handsFree' ? 'hands-free — just talk' : 'push-to-talk — space to talk';
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
      if (this.duplex && this.audio.mode === 'ptt') this.toggleMic();
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
      if (this.audio.mode === 'handsFree') this.audioLog.begin(this.modelId); // start the diagnostic timeline
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
    const threshold = this.creator === 'openai' ? 0.99 : 0.5;
    return {
      outputModalities: ['audio'],
      inputAudioFormat: { type: 'audio/pcm', rate: RATE },
      outputAudioFormat: { type: 'audio/pcm', rate: RATE },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      turnDetection:
        this.audio.mode === 'handsFree'
          ? { type: 'server-vad', threshold, silenceDurationMs: 600, prefixPaddingMs: 300 }
          : { type: 'disabled' },
    };
  }

  // Spacebar toggle (push-to-talk): open the mic (barging in over any current reply) or
  // close it and commit the captured audio as the user's turn. The audio bus owns the
  // mic buffer; the session cancel/clear/commit calls stay here.
  private toggleMic(): void {
    if (!this.session || this.connecting) return;
    if (!this.audio.isListening) {
      // Turning on: cut off any in-progress reply so the user can talk over it and the
      // model's voice never reaches the mic, then start a clean input buffer.
      if (this.wisp.speaking || this.status === 'responding') {
        this.audio.stopPlayback();
        this.session.cancelResponse();
        this.wisp.setSpeaking(false);
      }
      this.session.clearInput();
      this.transcript = ''; // fresh exchange — don't pile onto the last reply
      this.userTranscript = '';
      this.audio.beginListening();
    } else {
      // Turning off: end the turn and ask for a reply, unless nothing was captured.
      if (this.audio.endListening()) this.session.commitAudioAndRespond();
    }
  }

  private handlers(): RealtimeHandlers {
    return {
      onStatus: (s) => {
        this.status = s;
        this.connecting = s === 'connecting';
        if (s === 'open' && this.duplex) this.audio.startMic(); // begin streaming the mic once connected
        if (s === 'responding') this.wisp.setSpeaking(true);
        if (s === 'done') {
          this.audioLog.said(this.transcript);
          this.audioLog.event('response-done');
          this.audio.endReply(() => this.wisp.setSpeaking(false)); // flush the tail; drop the pulse when silent
        }
      },
      // Hands-free: server VAD detected the user speaking. Because the echo gate keeps
      // the model's own playback out of the mic stream, this only fires on real speech,
      // so it's a genuine barge-in — stop our playback (the server cancels its own
      // response) and start a fresh transcript for the new exchange.
      onSpeechStarted: () => {
        this.audioLog.event('speech-started');
        if (this.audio.mode !== 'handsFree') return;
        this.audio.stopPlayback();
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
        this.audio.play(pcm); // sidecar (also the AEC reference) / node-speaker / buffered
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
      : this.audio.isListening
        ? '● listening — space to send'
        : this.wisp.speaking
          ? 'speaking…'
          : this.status === 'responding'
            ? 'thinking…'
            : this.audio.mode === 'handsFree' && this.duplex
              ? '● just talk'
              : this.note || 'ready';
    const modeTag = this.duplex
      ? `  ·  ${this.audio.mode === 'handsFree' ? 'hands-free' : 'push-to-talk'}${this.audio.useAec ? ' · aec' : ''}`
      : '';
    surf.drawText(pad, rows - 7, trunc(`${this.modelId}   ·   ${state}${modeTag}`, w), [150, 200, 180], PANEL_BG, STYLE_BOLD);
    if (this.userTranscript) surf.drawText(pad, rows - 6, trunc(`you: ${this.userTranscript}`, w), [180, 200, 224], PANEL_BG);
    if (this.transcript) surf.drawText(pad, rows - 5, trunc(this.transcript, w), [220, 224, 234], PANEL_BG);
    surf.drawText(pad, rows - 4, trunc(`› ${this.input}_`, w), [240, 244, 255], PANEL_BG, STYLE_BOLD);
  }
}

// Keep the tail of a string (so a growing transcript/prompt shows the newest text)
// within `w` cells.
function trunc(s: string, w: number): string {
  return s.length <= w ? s : s.slice(s.length - w);
}
