// Server-side validation for the three ingest routes. The public client is untrusted,
// so the proxy re-checks shape, size, and the privacy boundary here — reusing the exact
// guard the client uses (isPrivacySafeRecord) so the two can never drift apart.
import { isPrivacySafeRecord, MAX_RECORD_BYTES } from '../../../src/telemetry/record-wire.ts';

export type RecordKind = 'event' | 'match' | 'poker_hand';

export { MAX_RECORD_BYTES };
// Whole-request ceiling: a small batch of NDJSON lines. The client posts one row per
// request today; this leaves headroom without inviting large-batch abuse.
export const MAX_BODY_BYTES = 1024 * 1024;
export const MAX_ROWS_PER_REQUEST = 100;

const STATUSES = new Set(['in_progress', 'completed', 'abandoned']);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Validate + privacy-check one parsed NDJSON line for the given route. Returns null on
// success or a short machine-readable reason on rejection. Never echoes payload content.
export function validateRow(kind: RecordKind, value: unknown): string | null {
  if (!isObject(value)) return 'not_an_object';

  if (kind === 'event') {
    if (typeof value.event !== 'string' || value.event === '') return 'missing_event';
    return isPrivacySafeRecord(value) ? null : 'forbidden_field';
  }

  // Canonical record row. The route — not the client body — is the trusted record type;
  // a mismatch means a client bug, so reject it rather than silently retag.
  if (value.recordType !== kind) return 'record_type_mismatch';
  for (const key of ['recordId', 'matchId', 'game', 'status', 'startedAt', 'payloadJson'] as const) {
    if (typeof value[key] !== 'string' || value[key] === '') return `bad_${key}`;
  }
  for (const key of ['recordRevision', 'recordSchemaVersion', 'participantCount', 'actionCount'] as const) {
    const n = value[key];
    if (typeof n !== 'number' || !Number.isFinite(n)) return `bad_${key}`;
  }
  if (!STATUSES.has(value.status as string)) return 'bad_status';

  let payload: unknown;
  try {
    payload = JSON.parse(value.payloadJson as string);
  } catch {
    return 'payload_unparseable';
  }
  // Guard both the flat row and the nested game payload; a forbidden key in either
  // (prompt, chat, reasoning, raw error, …) rejects the whole record.
  if (!isPrivacySafeRecord(value) || !isPrivacySafeRecord(payload)) return 'forbidden_field';
  return null;
}
