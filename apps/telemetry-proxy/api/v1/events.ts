// Vercel function: anonymous product/session events. The route fixes the record kind —
// the proxy never trusts a type from the client body.
import { makeHandler } from '../../lib/http.ts';
import { consoleSink } from '../../lib/sink.ts';
import { createRateLimiter } from '../../lib/rate-limit.ts';

const rateLimiter = createRateLimiter({ limit: 120, windowMs: 60_000 });

export default makeHandler('event', { sink: consoleSink, rateLimiter });
