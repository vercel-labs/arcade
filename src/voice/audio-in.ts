import { type ChildProcess, spawn, spawnSync } from 'node:child_process';

// Captures microphone audio for the realtime voice path: spawns a recorder that
// emits raw PCM16, 24 kHz mono (matching the session's input format) on stdout,
// and streams each chunk to a callback for `RealtimeSession.appendAudio`. Prefers
// sox's `rec` (uses the default input device, cross-platform); falls back to
// ffmpeg's avfoundation capture on macOS. Needs OS microphone permission for the
// terminal — first run may prompt or silently produce no audio until granted.

const SAMPLE_RATE = 24000;

const RECORDERS: { bin: string; args: string[] }[] = [
  { bin: 'rec', args: ['-q', '-t', 'raw', '-r', String(SAMPLE_RATE), '-e', 'signed', '-b', '16', '-c', '1', '-'] }, // sox
  { bin: 'ffmpeg', args: ['-f', 'avfoundation', '-i', ':default', '-ar', String(SAMPLE_RATE), '-ac', '1', '-f', 's16le', '-loglevel', 'quiet', 'pipe:1'] },
];

let cachedRecorder: { bin: string; args: string[] } | null | undefined;
function findRecorder(): { bin: string; args: string[] } | null {
  if (cachedRecorder !== undefined) return cachedRecorder;
  cachedRecorder = RECORDERS.find((r) => spawnSync('which', [r.bin]).status === 0) ?? null;
  return cachedRecorder;
}

/** Whether a microphone recorder is available (sox `rec` or ffmpeg). */
export function micAvailable(): boolean {
  return findRecorder() !== null;
}

export class MicCapture {
  private proc: ChildProcess | null = null;
  private spec = findRecorder();

  available(): boolean {
    return this.spec !== null;
  }

  // Begin capturing; `onChunk` receives raw PCM16 (24 kHz mono) buffers as they
  // arrive. `onError` reports a recorder failure (e.g. no mic / no permission).
  start(onChunk: (pcm: Buffer) => void, onError?: (message: string) => void): void {
    if (this.proc || !this.spec) return;
    const proc = spawn(this.spec.bin, this.spec.args, { stdio: ['ignore', 'pipe', 'ignore'] });
    proc.stdout?.on('data', (d: Buffer) => onChunk(d));
    proc.stdout?.on('error', () => {}); // swallow pipe errors on teardown (no crash)
    proc.on('error', (e) => onError?.(e.message));
    proc.on('exit', () => {
      if (this.proc === proc) this.proc = null;
    });
    this.proc = proc;
  }

  stop(): void {
    this.proc?.kill('SIGKILL');
    this.proc = null;
  }
}
