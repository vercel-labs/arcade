import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Bridge to a per-OS native AEC sidecar. Each sidecar OWNS both audio directions so
// the OS cancels the model's own speaker output from the mic: write the model's
// far-end PCM16 (24 kHz mono LE) to stdin (it plays it = the AEC reference), read
// echo-cancelled mic PCM16 (24 kHz mono LE) from stdout. This replaces sox capture +
// node-speaker playback when active, so the model never hears itself on speakers.
//
//   macOS   → native/aec-mac/aec-mac        (VoiceProcessingIO; built, tested)
//   Windows → native/aec-win/aec-win.exe    (Voice Capture DMO; UNTESTED — see its README)
//   Linux   → none (use PipeWire module-echo-cancel at the OS layer, or the software gate)
//
// Arcade picks the binary for `process.platform`; if it isn't present (not built /
// unsupported OS), `available()` is false and the caller falls back to sox +
// node-speaker. Set ARCADE_NO_AEC=1 to force the fallback.

// Per-platform sidecar binary, relative to this module (src/voice/).
const SIDECARS: Partial<Record<NodeJS.Platform, string>> = {
  darwin: '../../native/aec-mac/aec-mac',
  win32: '../../native/aec-win/aec-win.exe',
};

function resolveBinary(): string | null {
  const rel = SIDECARS[process.platform];
  if (!rel) return null;
  const path = fileURLToPath(new URL(rel, import.meta.url));
  return existsSync(path) ? path : null;
}

export class AecSidecar {
  private proc: ChildProcess | null = null;
  private control: NodeJS.WritableStream | null = null; // win32 flush channel (fd 3)

  /** Whether a native AEC sidecar exists for this OS (and isn't opted out). */
  available(): boolean {
    return process.env.ARCADE_NO_AEC !== '1' && resolveBinary() !== null;
  }

  // Spawn the sidecar. `onMic` receives echo-cancelled PCM16 (24 kHz mono) chunks;
  // `onError` reports spawn failure / non-zero exit (e.g. mic permission denied).
  start(onMic: (pcm: Buffer) => void, onError?: (message: string) => void): void {
    const bin = resolveBinary();
    if (this.proc || !bin) return;
    // Windows can't receive POSIX signals, so it gets a 4th pipe (fd 3) for control
    // (barge-in flush). macOS uses SIGUSR1 instead. stderr → ignore so the sidecar's
    // diagnostics never corrupt the TUI.
    const stdio: Array<'pipe' | 'ignore'> =
      process.platform === 'win32' ? ['pipe', 'pipe', 'ignore', 'pipe'] : ['pipe', 'pipe', 'ignore'];
    const proc = spawn(bin, [], { stdio });
    proc.stdout?.on('data', (d: Buffer) => onMic(d));
    proc.stdout?.on('error', () => {});
    proc.stdin?.on('error', () => {});
    this.control = (proc.stdio[3] as NodeJS.WritableStream | undefined) ?? null;
    this.control?.on('error', () => {});
    proc.on('error', (e) => onError?.(e.message));
    proc.on('exit', (code) => {
      if (this.proc === proc) {
        this.proc = null;
        this.control = null;
      }
      if (code != null && code !== 0) onError?.(`aec sidecar exited (code ${code})`);
    });
    this.proc = proc;
  }

  /** Feed a chunk of the model's reply audio (far-end) to be played + used as the AEC reference. */
  write(pcm: Buffer): void {
    const stdin = this.proc?.stdin;
    if (stdin?.writable) {
      try {
        stdin.write(pcm);
      } catch {
        // pipe broke; the exit handler will null the proc
      }
    }
  }

  /** Barge-in: drop the queued playback so the model's voice stops immediately. */
  flushPlayback(): void {
    try {
      if (process.platform === 'win32') this.control?.write(Buffer.from([0x66])); // 'f' = flush
      else this.proc?.kill('SIGUSR1');
    } catch {
      // process already gone
    }
  }

  stop(): void {
    this.proc?.kill();
    this.proc = null;
    this.control = null;
  }
}
