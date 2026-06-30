import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Diagnostic recorder for the hands-free voice path. Captures one interleaved
// timeline per session — mic-gate decisions (peak amplitude, whether the model was
// playing, forward/drop), the model's own audio output (peak + duration), VAD
// events, and BOTH transcripts (what the server thought the user said vs. what the
// model said). Written as JSONL to `.audio-logs/` when the session closes, so the
// "model hears itself" behaviour can be diagnosed after the fact: look for `mic`
// records with a high `peak` while `playMs > 0` (echo crossing the barge threshold),
// and `heard` text that echoes a recent `said`.
//
// On by default for hands-free sessions; set ARCADE_AUDIO_LOG=0 to disable.

export class AudioLog {
  private records: string[] = [];
  private start = 0;
  private active = false;

  /** Begin a fresh session timeline (no-op if disabled via env). */
  begin(model: string): void {
    if (process.env.ARCADE_AUDIO_LOG === '0') {
      this.active = false;
      return;
    }
    this.active = true;
    this.start = Date.now();
    this.records = [];
    this.add({ ev: 'session', model });
  }

  private add(rec: Record<string, unknown>): void {
    if (!this.active) return;
    this.records.push(JSON.stringify({ t: Date.now() - this.start, ...rec }));
  }

  /** A mic chunk and the gate's decision for it. */
  mic(peak: number, playMs: number, decision: string): void {
    this.add({ ev: 'mic', peak, playMs: Math.round(playMs), decision });
  }
  /** A chunk of the model's reply audio we played out (peak + duration ms). */
  out(peak: number, ms: number): void {
    this.add({ ev: 'out', peak, ms: Math.round(ms) });
  }
  /** A VAD / lifecycle event (speech-started, speech-stopped, response-done). */
  event(name: string): void {
    this.add({ ev: name });
  }
  /** What the server transcribed the user as saying (input transcription). */
  heard(text: string): void {
    this.add({ ev: 'heard', text });
  }
  /** What the model said (its reply transcript). */
  said(text: string): void {
    this.add({ ev: 'said', text });
  }

  // Write the timeline to `.audio-logs/handsfree-<start>.jsonl` and reset. Returns
  // the file path, or null if logging was inactive or nothing was recorded.
  flush(): string | null {
    if (!this.active || this.records.length <= 1) {
      this.active = false;
      this.records = [];
      return null;
    }
    const body = this.records.join('\n');
    this.active = false;
    this.records = [];
    try {
      const dir = join(process.cwd(), '.audio-logs');
      mkdirSync(dir, { recursive: true });
      const stamp = new Date(this.start).toISOString().replace(/[:.]/g, '-');
      const file = join(dir, `handsfree-${stamp}.jsonl`);
      appendFileSync(file, `${body}\n`);
      return file;
    } catch {
      return null; // best-effort — never break the session over a log write
    }
  }
}
