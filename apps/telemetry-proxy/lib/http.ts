// Adapts the pure ingest() core to the repo's Node-style Vercel handler signature — the
// same shape as the prism function — so the route files stay one line each. The core is
// shared with the tests, which exercise ingest() directly.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ingest } from './ingest.ts';
import { MAX_BODY_BYTES, type RecordKind } from './validation.ts';
import type { Sink } from './sink.ts';
import type { RateLimiter } from './rate-limit.ts';

function clientIp(req: IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
  return first || req.socket.remoteAddress || 'unknown';
}

async function readBody(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES * 2) return null; // hard stop well past the logical cap
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

export function makeHandler(kind: RecordKind, deps: { sink: Sink; rateLimiter?: RateLimiter }) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method_not_allowed' });
    const bodyText = await readBody(req);
    if (bodyText === null) return send(res, 413, { ok: false, error: 'request_too_large' });
    const result = await ingest({ kind, ip: clientIp(req), bodyText }, deps);
    send(res, result.status, result.body);
  };
}
