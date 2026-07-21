import { chmodSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CanonicalRecordRow, RecordTarget } from './records.ts';

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

// A record undeliverable for this long is dropped, so a persistently failing endpoint
// can never grow the on-disk queue without bound.
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

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
  maxAgeMs?: number;
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
  private enabled: boolean;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly maxAgeMs: number;

  constructor(private readonly opts: RecordOutboxOptions) {
    this.enabled = opts.enabled;
    this.fetchImpl = opts.fetch ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 12_000;
    this.maxAgeMs = opts.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  }

  // Telemetry consent is resolved after construction (the store is read at startup) and
  // can flip at runtime via the in-app toggle, so enabled is mutable.
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  enqueue(target: RecordTarget, row: CanonicalRecordRow): boolean {
    if (!this.enabled) return false;
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
    if (!this.enabled) return Promise.resolve();
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
        // Evict records too old to still be worth delivering (bounds queue growth when
        // the endpoint is persistently unhappy), independent of readability.
        try {
          if (Date.now() - statSync(path).mtimeMs > this.maxAgeMs) {
            rmSync(path, { force: true });
            removed++;
            continue;
          }
        } catch {
          // stat failed — fall through to normal handling below
        }
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
            // 2xx = the proxy durably accepted the record (it only 200s after the
            // downstream write is acknowledged) → delete it.
            if (response.ok) {
              let current: string;
              try {
                current = readFileSync(path, 'utf8');
              } catch {
                break;
              }
              if (current !== serialized) continue; // a newer revision landed; send that
              rmSync(path, { force: true });
              removed++;
              break;
            }
            // 408/429 = transient throttle/timeout, 5xx = server/network trouble, and
            // 404 = endpoint-level (the URL is fixed per target, so a 404 is never a
            // verdict on this record — e.g. a not-yet-provisioned proxy): stop this
            // drain and retry the whole queue on the next launch (don't hammer).
            if (response.status === 404 || response.status === 408 || response.status === 429 || response.status >= 500) return;
            // Any other 4xx is permanent for THIS record (malformed, oversized,
            // rejected): drop it so it can't wedge delivery of newer records behind it.
            rmSync(path, { force: true });
            removed++;
            break;
          } catch {
            return; // network error — retry next drain
          }
        }
      }
      // Nothing progressed this pass (all kept for retry) — stop to avoid a busy loop.
      if (removed === 0) return;
    }
  }
}
