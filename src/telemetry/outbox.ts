import { chmodSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CanonicalRecordRow, RecordTarget } from './records.ts';

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface OutboxEntry {
  target: RecordTarget;
  row: CanonicalRecordRow;
}

export interface RecordOutboxOptions {
  directory: string;
  enabled: boolean;
  endpoints: Record<RecordTarget, string>;
  fetch?: FetchLike;
  timeoutMs?: number;
}

function safeFilename(row: CanonicalRecordRow): string {
  const id = row.recordId.replace(/[^A-Za-z0-9._-]/g, '_');
  // One pending file per logical record: a newer checkpoint atomically replaces
  // an older unsent revision instead of growing the queue quadratically.
  return `${row.recordType}-${id}.json`;
}

// A tiny disk-backed queue. Records are written atomically before any network request;
// acknowledged rows are removed, while failures remain for the next launch. All methods
// swallow filesystem/network failures so telemetry can never degrade the arcade.
export class RecordOutbox {
  private draining: Promise<void> | null = null;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(private readonly opts: RecordOutboxOptions) {
    this.fetchImpl = opts.fetch ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 12_000;
  }

  enqueue(target: RecordTarget, row: CanonicalRecordRow): boolean {
    if (!this.opts.enabled) return false;
    try {
      mkdirSync(this.opts.directory, { recursive: true, mode: 0o700 });
      chmodSync(this.opts.directory, 0o700);
      const finalPath = join(this.opts.directory, safeFilename(row));
      const tempPath = join(this.opts.directory, `.tmp-${randomUUID()}`);
      writeFileSync(tempPath, JSON.stringify({ target, row } satisfies OutboxEntry), { mode: 0o600 });
      chmodSync(tempPath, 0o600);
      renameSync(tempPath, finalPath);
      void this.drain();
      return true;
    } catch {
      return false;
    }
  }

  drain(): Promise<void> {
    if (!this.opts.enabled) return Promise.resolve();
    if (this.draining) return this.draining;
    this.draining = this.drainQueued().finally(() => {
      this.draining = null;
    });
    return this.draining;
  }

  discardAll(): void {
    try {
      rmSync(this.opts.directory, { recursive: true, force: true });
    } catch {
      // best-effort opt-out cleanup
    }
  }

  queuedCount(): number {
    try {
      return readdirSync(this.opts.directory).filter((name) => name.endsWith('.json')).length;
    } catch {
      return 0;
    }
  }

  private async drainQueued(): Promise<void> {
    // Rescan after each batch so a different record enqueued while a request is in
    // flight is sent by this same drain rather than waiting for another game/launch.
    for (;;) {
      let names: string[];
      try {
        names = readdirSync(this.opts.directory).filter((name) => name.endsWith('.json')).sort();
      } catch {
        return;
      }
      if (names.length === 0) return;
      let removed = 0;
      for (const name of names) {
        const path = join(this.opts.directory, name);
        // A checkpoint may replace this file while an older revision is in flight.
        // Re-read and send again instead of deleting the newly written revision.
        for (;;) {
          let entry: OutboxEntry;
          let serialized: string;
          try {
            serialized = readFileSync(path, 'utf8');
            entry = JSON.parse(serialized) as OutboxEntry;
            if (!entry?.row || (entry.target !== 'match' && entry.target !== 'poker_hand')) break;
          } catch {
            break;
          }
          try {
            const response = await this.fetchImpl(this.opts.endpoints[entry.target], {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-ndjson' },
              body: `${JSON.stringify(entry.row)}\n`,
              signal: AbortSignal.timeout(this.timeoutMs),
            });
            // A 400/413 is permanent (malformed or oversized): the proxy will never
            // accept this record, so drop it rather than retry it forever. 429/5xx and
            // network failures stay queued for the next drain.
            if (response.status === 400 || response.status === 413) {
              rmSync(path, { force: true });
              removed++;
              break;
            }
            // Otherwise only a 200 means the downstream write was acknowledged.
            if (response.status !== 200) return;
            let current: string;
            try {
              current = readFileSync(path, 'utf8');
            } catch {
              break;
            }
            if (current !== serialized) continue;
            rmSync(path, { force: true });
            removed++;
            break;
          } catch {
            return;
          }
        }
      }
      // Malformed/unreadable rows remain for inspection without causing a busy loop.
      if (removed === 0) return;
    }
  }
}
