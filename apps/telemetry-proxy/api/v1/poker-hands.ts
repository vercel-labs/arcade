// Vercel function: complete poker hand records.
import { makeHandler } from '../../lib/http.ts';
import { consoleSink } from '../../lib/sink.ts';
import { createRateLimiter } from '../../lib/rate-limit.ts';

const rateLimiter = createRateLimiter({ limit: 120, windowMs: 60_000 });

export default makeHandler('poker_hand', { sink: consoleSink, rateLimiter });
