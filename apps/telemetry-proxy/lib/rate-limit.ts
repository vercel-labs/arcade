// A fixed-window in-memory limiter, per process instance. This is a cheap first line so
// a single client can't flood the pipeline; platform-level rate limiting (Vercel WAF)
// can layer on top for distributed enforcement.
export interface RateLimiter {
  allow(key: string): boolean;
}

export function createRateLimiter(opts: { limit: number; windowMs: number; now?: () => number }): RateLimiter {
  const windows = new Map<string, { count: number; resetAt: number }>();
  const now = opts.now ?? (() => Date.now());
  return {
    allow(key) {
      const t = now();
      const cur = windows.get(key);
      if (!cur || t >= cur.resetAt) {
        windows.set(key, { count: 1, resetAt: t + opts.windowMs });
        return true;
      }
      if (cur.count >= opts.limit) return false;
      cur.count += 1;
      return true;
    },
  };
}
