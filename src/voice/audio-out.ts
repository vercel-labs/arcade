import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hasCommand } from './has-command.ts';

// Plays the PCM16 audio streamed back from a realtime voice session. The gateway
// sends 24 kHz mono signed-16-bit little-endian PCM in base64 chunks. Two players:
// `StreamPlayer` streams gaplessly to the OS device via node-speaker (the realtime
// path); `AudioPlayer` accumulates a reply, wraps it in a WAV header, and plays the
// finished file with a CLI player (afplay/ffplay/sox) — the fallback when the
// native speaker sink isn't available.

const SAMPLE_RATE = 24000;

// First available CLI player. afplay takes the file as the last arg; ffplay/sox's
// `play` need flags to run headless (no window) and exit when the clip ends.
const PLAYERS: { bin: string; args: string[] }[] = [
  { bin: 'afplay', args: [] },
  { bin: 'ffplay', args: ['-nodisp', '-autoexit', '-loglevel', 'quiet'] },
  { bin: 'play', args: ['-q'] }, // sox
];

let cachedPlayer: { bin: string; args: string[] } | null | undefined;
function findPlayer(): { bin: string; args: string[] } | null {
  if (cachedPlayer !== undefined) return cachedPlayer;
  cachedPlayer = PLAYERS.find((p) => hasCommand(p.bin)) ?? null;
  return cachedPlayer;
}

/** Whether any supported audio player is on PATH (afplay / ffplay / sox). */
export function audioAvailable(): boolean {
  return findPlayer() !== null;
}

export class AudioPlayer {
  private chunks: Buffer[] = [];
  private dir = mkdtempSync(join(tmpdir(), 'arcade-audio-'));
  private seq = 0;
  private playing = false;

  /** Buffer a PCM16 chunk from the session (does not play yet). */
  push(pcm: Buffer): void {
    this.chunks.push(pcm);
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  // Wrap the buffered PCM in a WAV file and play it; `onDone` fires when playback
  // finishes (or immediately when there's nothing to play / no player available),
  // so the caller can drop the wisp's "speaking" pulse exactly when sound stops.
  flush(onDone?: () => void): void {
    const pcm = Buffer.concat(this.chunks.splice(0));
    const player = findPlayer();
    if (pcm.length === 0 || !player) {
      onDone?.();
      return;
    }
    const file = join(this.dir, `reply-${this.seq++}.wav`);
    writeFileSync(file, toWav(pcm, SAMPLE_RATE));
    this.playing = true;
    const finish = (): void => {
      this.playing = false;
      onDone?.();
    };
    const child = spawn(player.bin, [...player.args, file], { stdio: 'ignore' });
    child.on('close', finish);
    child.on('error', finish);
  }
}

// Streaming player for the realtime path. node-speaker is a native Writable PCM
// sink that streams straight to the OS audio device (CoreAudio / ALSA / win32),
// so it plays the model's voice gaplessly AS it arrives. This is the right tool
// for real-time PCM: the Realtime API emits audio faster than realtime in bursts,
// and a continuous device sink with its own ring buffer + Node stream backpressure
// rate-matches it — whereas piping that bursty PCM to a CLI player (ffplay/sox)
// underruns on the gaps and drops samples to resync (choppy, "skips forward").
// node-speaker is an OPTIONAL native dependency: if its addon isn't built we leave
// the sink unavailable and callers fall back to the file-based AudioPlayer.
const nodeRequire = createRequire(import.meta.url);
let SpeakerCtor: typeof import('speaker') | null = null;
try {
  SpeakerCtor = nodeRequire('speaker') as typeof import('speaker');
} catch {
  SpeakerCtor = null; // native addon missing → available() is false, file fallback used
}

// Leading silence written when a speaker opens, so the device callback never starts
// on an empty buffer (~60ms, inaudible).
const PRIME_BYTES = Math.round((SAMPLE_RATE * 2 * 60) / 1000);

export class StreamPlayer {
  private speaker: InstanceType<typeof import('speaker')> | null = null;
  // Wall-clock estimate of when the buffered audio finishes playing. node-speaker
  // plays at realtime, so each write pushes this out by the chunk's duration; it
  // decays back to "now" as the device drains. Lets callers (the hands-free echo
  // gate) know whether the model is still audibly speaking.
  private playUntil = 0;

  /** Whether the native PCM sink is available. */
  available(): boolean {
    return SpeakerCtor !== null;
  }

  /** Estimated milliseconds of audio still queued/playing (0 when silent). */
  queuedMs(): number {
    return Math.max(0, this.playUntil - Date.now());
  }

  private ensure(): InstanceType<typeof import('speaker')> | null {
    if (!SpeakerCtor) return null;
    if (!this.speaker) {
      try {
        // signed:true is REQUIRED — at 16-bit node-speaker defaults to UNSIGNED, which
        // would render OpenAI's signed PCM16 as noise. The cast carries `signed`, which
        // the runtime honors but the bundled Options type omits.
        const sp = new SpeakerCtor({ channels: 1, bitDepth: 16, sampleRate: SAMPLE_RATE, signed: true } as import('speaker').Options);
        sp.on('error', () => {
          if (this.speaker === sp) this.speaker = null; // device error → next write reopens
        });
        // Prime with a brief silence so the device's render callback has data on its
        // first tick — otherwise it can underflow (and warn to stderr) before the
        // first real chunk lands. Inaudible; adds only PRIME_MS of leading silence.
        sp.write(Buffer.alloc(PRIME_BYTES));
        this.speaker = sp;
      } catch {
        return null; // no output device available → caller silently skips this chunk
      }
    }
    return this.speaker;
  }

  // Write a PCM16 chunk to the device. The sink applies backpressure via the Node
  // Writable contract; we don't manage a lead-in buffer ourselves — the device's
  // own output buffer absorbs the inter-chunk jitter.
  write(pcm: Buffer): void {
    const sp = this.ensure();
    if (!sp) return;
    try {
      sp.write(pcm);
      // Advance the play-cursor estimate by this chunk's duration (2 bytes/sample).
      const ms = (pcm.length / 2 / SAMPLE_RATE) * 1000;
      this.playUntil = Math.max(this.playUntil, Date.now()) + ms;
    } catch {
      this.speaker = null; // sink broke mid-write; the next write reopens it
    }
  }

  // The reply finished: end the stream so node-speaker flushes the buffered tail,
  // plays it out, and CLOSES the device. Required — leaving the speaker open while
  // idle makes CoreAudio's render callback fire on an empty buffer and spam
  // "buffer underflow" warnings to stderr (which corrupts the TUI). The next reply
  // opens a fresh speaker via write()/ensure().
  endReply(): void {
    const sp = this.speaker;
    this.speaker = null;
    if (sp) {
      try {
        sp.end(); // flush + play remaining audio, then auto-close the device
      } catch {
        // already ended — nothing to do
      }
    }
  }

  /** Stop playback immediately and discard buffered audio (barge-in / cleanup). */
  interrupt(): void {
    this.playUntil = 0; // buffered audio is dropped → nothing queued
    const sp = this.speaker;
    this.speaker = null;
    if (sp) {
      try {
        sp.close(false); // false = don't flush; drop the buffered tail at once
      } catch {
        // already closed — nothing to do
      }
    }
  }
}

// A minimal 44-byte WAV header wrapping mono signed-16 LE PCM at `sampleRate`.
export function toWav(pcm: Buffer, sampleRate: number = SAMPLE_RATE): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM fmt chunk size
  header.writeUInt16LE(1, 20); // format = PCM
  header.writeUInt16LE(1, 22); // channels = mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate (mono, 2 bytes/sample)
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits/sample
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
