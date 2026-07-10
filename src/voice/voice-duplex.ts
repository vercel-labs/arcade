import { AudioPlayer, StreamPlayer } from './audio-out.ts';
import { MicCapture, micAvailable } from './audio-in.ts';
import { AecSidecar } from './aec-sidecar.ts';

// The full-duplex audio bus for a realtime voice conversation: microphone capture,
// the software echo gate, and reply playback — everything BUT the WebSocket session
// and the UI. Both the arcade's voice screen (AudioScene) and the poker table
// (PokerVoice) drive one RealtimeSession through this, so echo cancellation and
// barge-in behave identically. The session, the wisp/UI, and diagnostics stay with
// the caller; this only moves audio.
//
// I/O has two mutually-exclusive paths, picked at `probe`: the macOS VoiceProcessingIO
// sidecar (owns mic + playback in one OS-AEC unit, so the model never hears itself),
// or sox/ffmpeg mic + node-speaker streaming (with the software gate below).

// PCM16 sample rate shared by input + output audio.
export const AUDIO_RATE = 24000;

// Hands-free echo gate (values from OpenAI's Codex CLI, tunable): while the model's
// audio is playing, drop mic chunks whose peak amplitude is below BARGE_PEAK (likely
// speaker echo); a louder chunk is treated as real speech and opens a GRACE_MS window
// during which all mic audio is forwarded so a barge-in (and its quieter syllables)
// reaches the server's VAD intact.
const BARGE_PEAK = 4000; // peak |int16| (0–32767) that counts as intentional speech
const GRACE_MS = 900; // keep forwarding this long after a loud chunk

export type VoiceMode = 'ptt' | 'handsFree';

export interface VoiceDuplexHandlers {
  /** A captured mic chunk cleared the echo gate — forward it to the session. */
  onForward(pcm16: Buffer): void;
  /** The gate's decision on a mic chunk (peak, ms of model audio queued), for diagnostics. */
  onMicDecision?(peak: number, playMs: number, decision: string): void;
  /** A mic-recorder error message. */
  onError?(message: string): void;
}

export class VoiceDuplex {
  // Output: stream when ffplay/sox is present (low-latency, barge-in-able), otherwise
  // buffer-and-play whole replies with afplay.
  private streamPlayer = new StreamPlayer();
  private bufferPlayer = new AudioPlayer();
  private mic = new MicCapture();
  private aecSidecar = new AecSidecar();
  private micStarted = false;

  private _useAec = false;
  private _streaming = false;
  private _mode: VoiceMode = 'ptt';
  private listening = false; // push-to-talk mic is open
  private sentWhileOpen = false; // any mic audio forwarded since the mic opened
  private bargeUntil = 0; // hands-free: forward all mic audio until this time (barge-in grace)

  constructor(private readonly handlers: VoiceDuplexHandlers) {}

  // Probe the available I/O. `hasKey` gates duplex (no key → no live session to talk
  // to). With the AEC sidecar, voice works regardless of sox/node-speaker (it provides
  // both); otherwise we need a streaming player + a mic recorder. Sets the default mode:
  // hands-free when AEC is present (its whole point is speakers), else push-to-talk;
  // ARCADE_VOICE_MODE overrides.
  probe(hasKey: boolean): { duplex: boolean; streaming: boolean; useAec: boolean } {
    this._streaming = this.streamPlayer.available();
    this._useAec = this.aecSidecar.available();
    const duplex = (this._useAec || (this._streaming && micAvailable())) && hasKey;
    this._mode =
      process.env.ARCADE_VOICE_MODE === 'handsfree'
        ? 'handsFree'
        : process.env.ARCADE_VOICE_MODE === 'ptt'
          ? 'ptt'
          : this._useAec
            ? 'handsFree'
            : 'ptt';
    return { duplex, streaming: this._streaming, useAec: this._useAec };
  }

  get useAec(): boolean {
    return this._useAec;
  }
  get streaming(): boolean {
    return this._streaming;
  }
  get mode(): VoiceMode {
    return this._mode;
  }
  setMode(m: VoiceMode): void {
    this._mode = m;
  }
  toggleMode(): VoiceMode {
    this._mode = this._mode === 'ptt' ? 'handsFree' : 'ptt';
    return this._mode;
  }
  get isListening(): boolean {
    return this.listening;
  }

  // Start capturing the mic once and keep it running. The AEC sidecar provides the
  // (echo-cancelled) mic when present; otherwise sox does. Each chunk routes through
  // the echo gate. The stream stays warm across turns either way.
  startMic(): void {
    if (this.micStarted) return;
    this.micStarted = true;
    const onChunk = (pcm: Buffer): void => this.forwardMic(pcm);
    const onErr = (m: string): void => this.handlers.onError?.(m);
    if (this._useAec) this.aecSidecar.start(onChunk, onErr);
    else this.mic.start(onChunk, onErr);
  }

  // Decide whether a captured mic chunk goes to the model. Push-to-talk forwards only
  // while listening. Hands-free forwards continuously — with AEC the mic is already
  // clean (forward directly); otherwise run the software echo gate.
  private forwardMic(pcm: Buffer): void {
    if (this._mode === 'handsFree') {
      if (this._useAec) this.handlers.onForward(pcm);
      else this.gateChunk(pcm);
      return;
    }
    if (!this.listening) return;
    this.sentWhileOpen = true;
    this.handlers.onForward(pcm);
  }

  // Hands-free echo gate. While the model's audio is playing, drop low-amplitude mic
  // chunks (its own output bleeding into the mic); a loud chunk is real speech —
  // forward it and open a grace window so the rest of the barge-in reaches the model.
  private gateChunk(pcm: Buffer): void {
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
    this.handlers.onMicDecision?.(peak, playMs, decision);
    if (decision !== 'drop-echo') this.handlers.onForward(pcm);
  }

  // Push-to-talk: open a clean input buffer. The caller stops any current reply +
  // clears the session buffer around this.
  beginListening(): void {
    this.sentWhileOpen = false;
    this.listening = true;
  }
  // Push-to-talk: close the mic; returns whether any audio was captured (so the caller
  // knows whether to commit the turn and ask for a reply).
  endListening(): boolean {
    this.listening = false;
    return this.sentWhileOpen;
  }

  // Route a chunk of the model's reply audio to the speaker. With AEC the sidecar plays
  // it AND uses it as the cancellation reference; else stream or buffer it.
  play(pcm: Buffer): void {
    if (this._useAec) this.aecSidecar.write(pcm);
    else if (this._streaming) this.streamPlayer.write(pcm);
    else this.bufferPlayer.push(pcm);
  }

  // End of a reply: flush the tail. With AEC the sidecar keeps playing its buffered tail
  // (nothing to flush); buffered playback drains with a callback; streaming closes the
  // device (stops CoreAudio underflow spam). `onDrained` fires when it's safe to drop the
  // speaking indicator.
  endReply(onDrained?: () => void): void {
    if (this._useAec) {
      onDrained?.(); // sidecar keeps playing its buffered tail; UI can stop the pulse
    } else if (!this._streaming) {
      this.bufferPlayer.flush(() => onDrained?.());
    } else {
      this.streamPlayer.endReply();
      onDrained?.();
    }
  }

  // Stop the model's voice immediately (barge-in / cleanup): flush the AEC sidecar's
  // playback ring, or kill the node-speaker stream when not using AEC.
  stopPlayback(): void {
    if (this._useAec) this.aecSidecar.flushPlayback();
    else this.streamPlayer.interrupt();
  }

  // Tear down all audio I/O: stop the mic (sox/AEC), drop any buffered playback, reset
  // turn state. The caller closes the session separately.
  stop(): void {
    this.mic.stop();
    this.aecSidecar.stop();
    this.micStarted = false;
    this.streamPlayer.interrupt();
    this.listening = false;
    this.bargeUntil = 0;
  }
}

// Peak absolute amplitude (0–32767) of a PCM16 little-endian mono buffer. Scans with a
// stride for speed — enough to tell speaker echo (quiet) from intentional speech.
export function pcm16Peak(buf: Buffer): number {
  let peak = 0;
  for (let i = 0; i + 1 < buf.length; i += 2 * 4) {
    // step 4 samples (8 bytes); reading every sample isn't needed for an envelope
    const s = buf.readInt16LE(i);
    const a = s < 0 ? -s : s;
    if (a > peak) peak = a;
  }
  return peak;
}
