// The transport-agnostic core of the proxy: take a route kind + client IP + raw body,
// enforce limits and validation, and forward to the sink. Pure and side-effect-free
// (beyond the sink), so it is exhaustively unit-testable without a running server.
import {
  MAX_BODY_BYTES,
  MAX_RECORD_BYTES,
  MAX_ROWS_PER_REQUEST,
  validateRow,
  type RecordKind,
} from './validation.ts';
import type { RateLimiter } from './rate-limit.ts';
import type { Sink } from './sink.ts';

export interface IngestRequest {
  kind: RecordKind;
  ip: string;
  bodyText: string;
}

export interface IngestDeps {
  sink: Sink;
  rateLimiter?: RateLimiter;
}

export type IngestStatus = 200 | 400 | 413 | 429 | 503;
export interface IngestResult {
  status: IngestStatus;
  body: { ok: true; count: number } | { ok: false; error: string };
}

const bytes = (s: string): number => Buffer.byteLength(s, 'utf8');
const reject = (status: Exclude<IngestStatus, 200>, error: string): IngestResult => ({ status, body: { ok: false, error } });

export async function ingest(req: IngestRequest, deps: IngestDeps): Promise<IngestResult> {
  if (deps.rateLimiter && !deps.rateLimiter.allow(req.ip)) return reject(429, 'rate_limited');
  if (bytes(req.bodyText) > MAX_BODY_BYTES) return reject(413, 'request_too_large');

  const lines = req.bodyText.split('\n').map((l) => l.trim()).filter((l) => l !== '');
  if (lines.length === 0) return reject(400, 'empty_body');
  if (lines.length > MAX_ROWS_PER_REQUEST) return reject(400, 'too_many_rows');

  const rows: unknown[] = [];
  for (const line of lines) {
    if (bytes(line) > MAX_RECORD_BYTES) return reject(413, 'record_too_large');
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return reject(400, 'invalid_json');
    }
    const reason = validateRow(req.kind, parsed);
    if (reason) return reject(400, reason);
    rows.push(parsed);
  }

  const delivered = await deps.sink.deliver(req.kind, rows);
  if (delivered !== 'ok') return reject(503, 'downstream_unavailable');
  return { status: 200, body: { ok: true, count: rows.length } };
}
