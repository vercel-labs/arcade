import { consoleSink, createTinybirdSink } from './sink.ts';
import { rateLimiterFromEnv } from './rate-limit.ts';
import type { IngestDeps } from './ingest.ts';
import type { RecordKind } from './validation.ts';

// Route kind → Tinybird datasource in the Vercel_AI workspace.
const DATASOURCE: Record<RecordKind, string> = {
  event: 'arcade_events_v1',
  match: 'arcade_match_records_v1',
  poker_hand: 'arcade_poker_hand_records_v1',
};

// Built once per instance from env. Tinybird sink when a token is configured (production);
// otherwise the console sink, so local/preview deploys need no credential. Limits are
// generous per-IP (shared egress: NAT/CI/mobile) with a tighter per-playerKey cap.
export function makeDeps(): IngestDeps {
  const token = process.env.TINYBIRD_TOKEN;
  const host = process.env.TINYBIRD_HOST || 'https://api.us-east.tinybird.co';
  return {
    sink: token ? createTinybirdSink({ token, host, datasource: DATASOURCE }) : consoleSink,
    rateLimiter: rateLimiterFromEnv({ limit: 300, windowSec: 60 }),
    perKeyLimiter: rateLimiterFromEnv({ limit: 60, windowSec: 60 }),
  };
}
