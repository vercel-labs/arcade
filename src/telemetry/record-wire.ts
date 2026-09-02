import type { CanonicalGameRecord, RecordStatus } from '../harness/records.ts';

export type RecordTarget = 'match' | 'poker_hand';

export interface CanonicalRecordRow {
  emittedAt: string;
  sessionId: string;
  /** Pseudonymous per-install key when a human played (else ''); links a user's own games. */
  playerKey: string;
  environment: 'dev' | 'prod';
  appVersion: string;
  recordType: CanonicalGameRecord['recordType'];
  recordSchemaVersion: number;
  recordId: string;
  recordRevision: number;
  matchId: string;
  handId: string;
  handNumber: number;
  game: string;
  rulesVersion: string;
  status: RecordStatus;
  endReason: string;
  startedAt: string;
  /** Omitted while in progress; the datasource's DEFAULT (epoch) fills the column. */
  endedAt?: string;
  participantCount: number;
  actionCount: number;
  payloadJson: string;
}

const FORBIDDEN_KEYS = new Set([
  'prompt', 'systemprompt', 'reasoning', 'thinking', 'chat', 'tabletalk', 'voice',
  'audio', 'transcript', 'rationale', 'commentary', 'raw', 'rawresponse', 'error',
  'errormessage', 'providererror', 'message',
]);

// Product transport ceiling, deliberately kept out of the public harness contract.
// Vercel Functions reject request bodies around 4.5 MiB before application
// validation. Keep the complete one-row NDJSON request comfortably below it.
export const MAX_RECORD_ROW_BYTES = 4 * 1024 * 1024;
export const MAX_RECORD_BYTES = MAX_RECORD_ROW_BYTES - 128 * 1024;

export function isPrivacySafeRecord(value: unknown, seen = new Set<object>()): boolean {
  if (value === undefined || value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true;
  if (typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.every((item) => isPrivacySafeRecord(item, seen));
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key.replace(/[_-]/g, '').toLowerCase())) return false;
    if (!isPrivacySafeRecord(nested, seen)) return false;
  }
  return true;
}

export function recordTarget(record: CanonicalGameRecord): RecordTarget {
  return record.recordType === 'poker_hand' ? 'poker_hand' : 'match';
}

export function toCanonicalRecordRow(
  record: CanonicalGameRecord,
  envelope: { session: string; env: 'dev' | 'prod'; appVersion: string; playerKey?: string; emittedAt?: string },
): CanonicalRecordRow | null {
  if (!isPrivacySafeRecord(record)) return null;
  try {
    const payload = JSON.stringify(record);
    if (Buffer.byteLength(payload) > MAX_RECORD_BYTES) return null;
    const hand = record.recordType === 'poker_hand' ? record : null;
    const hasHuman = record.participants.some((participant) => participant.kind === 'human');
    const row: CanonicalRecordRow = {
      emittedAt: envelope.emittedAt ?? new Date().toISOString(),
      sessionId: envelope.session,
      playerKey: hasHuman ? (envelope.playerKey ?? '') : '',
      environment: envelope.env,
      appVersion: envelope.appVersion,
      recordType: record.recordType,
      recordSchemaVersion: record.recordSchemaVersion,
      recordId: record.recordId,
      recordRevision: record.revision,
      matchId: record.matchId,
      handId: hand?.handId ?? '',
      handNumber: hand?.handNumber ?? 0,
      game: record.game,
      rulesVersion: record.rulesVersion,
      status: record.status,
      endReason: record.endReason ?? '',
      startedAt: record.startedAt,
      endedAt: record.endedAt,
      participantCount: record.participants.length,
      actionCount: record.actions.length,
      payloadJson: payload,
    };
    return Buffer.byteLength(JSON.stringify(row)) <= MAX_RECORD_ROW_BYTES ? row : null;
  } catch {
    return null;
  }
}
