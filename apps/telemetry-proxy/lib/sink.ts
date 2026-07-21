import type { RecordKind } from './validation.ts';

export type DeliveryResult = 'ok' | 'downstream_error';

// The proxy's downstream. Kept behind this interface so the storage backend can change
// (api-o11y-ingestion, or a direct ClickHouse writer) without touching request handling.
// A sink returns 'ok' only once the downstream has durably accepted the rows, so the
// handler can translate that into the client's delete-on-200 contract.
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
