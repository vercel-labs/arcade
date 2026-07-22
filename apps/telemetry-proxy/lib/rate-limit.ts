// Rate limiting + IP blocklist for the public ingest endpoint. Two implementations behind
// one async interface: an in-memory per-instance backstop, and a KV-backed limiter (shared
// across the serverless fleet). Both fail OPEN — dropping anonymous telemetry during a KV
// blip is worse than briefly not limiting; the platform WAF rate-limit rule is the hard
// backstop that makes fail-open acceptable.

export type RateVerdict = 'ok' | 'limited' | 'blocked';

export interface RateLimiter {
  check(key: string): Promise<RateVerdict>;
}

// Per-process fixed window. Serverless fans out to many instances (each with its own map),
// so this only bounds a single instance — a cheap first tier, not real enforcement.
export function createMemoryRateLimiter(opts: { limit: number; windowMs: number; now?: () => number }): RateLimiter {
  const windows = new Map<string, { count: number; resetAt: number }>();
  const now = opts.now ?? (() => Date.now());
  return {
    async check(key) {
      const t = now();
      const cur = windows.get(key);
      if (!cur || t >= cur.resetAt) {
        windows.set(key, { count: 1, resetAt: t + opts.windowMs });
        return 'ok';
      }
      if (cur.count >= opts.limit) return 'limited';
      cur.count += 1;
      return 'ok';
    },
  };
}

// KV-backed fixed window + blocklist over the Upstash / Vercel-KV REST API — zero deps,
// plain fetch, shared across instances. A `block:<key>` entry hard-blocks a client.
export function createKvRateLimiter(opts: {
  url: string;
  token: string;
  limit: number;
  windowSec: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}): RateLimiter {
  const f = opts.fetchImpl ?? fetch;
  const now = opts.now ?? (() => Date.now());
  const base = opts.url.replace(/\/+$/, '');
  const call = async (...cmd: (string | number)[]): Promise<unknown> => {
    const path = cmd.map((c) => encodeURIComponent(String(c))).join('/');
    const res = await f(`${base}/${path}`, {
      headers: { Authorization: `Bearer ${opts.token}` },
      signal: AbortSignal.timeout(1000),
    });
    if (!res.ok) throw new Error(`kv ${res.status}`);
    return ((await res.json()) as { result: unknown }).result;
  };
  return {
    async check(key) {
      try {
        if (await call('get', `block:${key}`)) return 'blocked';
        const windowKey = `rl:${key}:${Math.floor(now() / (opts.windowSec * 1000))}`;
        const count = Number(await call('incr', windowKey));
        if (count === 1) await call('expire', windowKey, opts.windowSec);
        return count > opts.limit ? 'limited' : 'ok';
      } catch {
        return 'ok'; // fail open
      }
    },
  };
}

// Pick a limiter from env: KV when configured (production), else the in-memory backstop.
export function rateLimiterFromEnv(opts: { limit: number; windowSec: number }): RateLimiter {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return createKvRateLimiter({ url, token, limit: opts.limit, windowSec: opts.windowSec });
  return createMemoryRateLimiter({ limit: opts.limit, windowMs: opts.windowSec * 1000 });
}
