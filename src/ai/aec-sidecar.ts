import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Bridge to the macOS VoiceProcessingIO AEC sidecar (native/aec-mac). When present,
// it OWNS both audio directions through one VPIO unit so the OS cancels the model's
// own speaker output from the mic: write the model's far-end PCM16 (24 kHz mono LE)
// to its stdin (it plays it = the AEC reference), and read echo-cancelled mic PCM16
// from its stdout. This replaces sox capture + node-speaker playback when active, so
// the model never hears itself on speakers — no headphones, no software echo gate.
//
// Build it with `native/aec-mac/build.sh`. Unavailable (not built / non-macOS) →
// the caller falls back to the sox + node-speaker path. Set ARCADE_NO_AEC=1 to skip.

const BIN = fileURLToPath(new URL('../../native/aec-mac/aec-mac', import.meta.url));

export class AecSidecar {
  private proc: ChildProcess | null = null;

  /** Whether the native AEC sidecar can be used (macOS + built + not opted out). */
  available(): boolean {
    return process.platform === 'darwin' && process.env.ARCADE_NO_AEC !== '1' && existsSync(BIN);
  }

  // Spawn the sidecar. `onMic` receives echo-cancelled PCM16 (24 kHz mono) chunks;
  // `onError` reports spawn failure / non-zero exit (e.g. mic permission denied).
  start(onMic: (pcm: Buffer) => void, onError?: (message: string) => void): void {
    if (this.proc || !this.available()) return;
    // stderr → 'ignore': the sidecar's diagnostics must not corrupt the TUI.
    const proc = spawn(BIN, [], { stdio: ['pipe', 'pipe', 'ignore'] });
    proc.stdout?.on('data', (d: Buffer) => onMic(d));
    proc.stdout?.on('error', () => {});
    proc.stdin?.on('error', () => {});
    proc.on('error', (e) => onError?.(e.message));
    proc.on('exit', (code) => {
      if (this.proc === proc) this.proc = null;
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
        // pipe broke; exit handler will null the proc
      }
    }
  }

  /** Barge-in: drop the queued playback so the model's voice stops immediately. */
  flushPlayback(): void {
    try {
      this.proc?.kill('SIGUSR1');
    } catch {
      // process already gone
    }
  }

  stop(): void {
    this.proc?.kill('SIGTERM');
    this.proc = null;
  }
}
