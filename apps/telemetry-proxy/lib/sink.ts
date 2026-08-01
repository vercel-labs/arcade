import type { RecordKind } from './validation.ts';

export type DeliveryResult = 'ok' | 'downstream_error';

// The proxy's downstream. Kept behind this interface so the storage backend can change
// without touching request handling. A sink returns 'ok' only once the downstream has
// durably accepted the rows, so the handler can translate that into the client's
// delete-on-200 contract.
export interface Sink {
  deliver(kind: RecordKind, rows: unknown[]): Promise<DeliveryResult>;
}

// Default sink for local runs and previews: acknowledges without forwarding, and logs
// only counts — never record contents, so payloads never reach the proxy's logs.
export const consoleSink: Sink = {
  async deliver(kind, rows) {
    console.log(JSON.stringify({ event: 'telemetry_ingest', kind, count: rows.length }));
    return 'ok';
  },
};

export interface TinybirdConfig {
  token: string;
  host: string; // e.g. https://api.us-east.tinybird.co
  datasource: Record<RecordKind, string>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

// Forwards a request's rows to the Tinybird Events API as ONE NDJSON call per request.
// Critical: `wait=true` makes Tinybird acknowledge only after the row is committed, and a
// schema-mismatched row is reported as `quarantined_rows` with an HTTP 200 — so we treat
// any quarantine (or a non-2xx) as failure and return 'downstream_error', which keeps the
// record queued on the client instead of silently losing it.
export function createTinybirdSink(cfg: TinybirdConfig): Sink {
  const f = cfg.fetchImpl ?? fetch;
  const timeoutMs = cfg.timeoutMs ?? 8000;
  const host = cfg.host.replace(/\/+$/, '');
  return {
    async deliver(kind, rows) {
      const name = cfg.datasource[kind];
      const body = rows.map((r) => JSON.stringify(r)).join('\n');
      try {
        const res = await f(`${host}/v0/events?name=${encodeURIComponent(name)}&wait=true`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/x-ndjson' },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) return 'downstream_error';
        const result = (await res.json().catch(() => null)) as { quarantined_rows?: number } | null;
        if (result && typeof result.quarantined_rows === 'number' && result.quarantined_rows > 0) {
          return 'downstream_error'; // schema drift quarantined the row; don't ack the loss
        }
        return 'ok';
      } catch {
        return 'downstream_error'; // timeout / network — client keeps it queued
      }
    },
  };
}
