// Proxies the browser's request for the ascii-prisms stream through this app's own
// origin, so the hero's xterm.js terminal can `fetch` it without a cross-origin
// request — ascii-prisms.vercel.app's handler (src/prism/prism-stream.ts) sends no
// CORS headers, and it's shared by three consumers already, so this route adapts
// around it here rather than changing it there. No engine/rendering code lives in
// this app: the actual frames are rendered, diffed, and cached by ascii-prisms itself.
export const dynamic = 'force-dynamic';

const UPSTREAM = 'https://ascii-prisms.vercel.app/';

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const upstream = new URL(UPSTREAM);
  upstream.searchParams.set('stream', '');
  upstream.searchParams.set('web', '1');
  upstream.searchParams.set('truecolor', '1');
  for (const key of ['cols', 'rows']) {
    const value = url.searchParams.get(key);
    if (value) upstream.searchParams.set(key, value);
  }

  let res: Response;
  try {
    res = await fetch(upstream, { signal: req.signal });
  } catch {
    return Response.json({
      error: {
        code: 'PRISM_UPSTREAM_UNAVAILABLE',
        message: 'The live prism stream is temporarily unavailable.',
        resolution: 'Retry the request or use the local snapshot command documented at /docs/examples.',
      },
    }, { status: 502 });
  }

  if (!res.ok) {
    return Response.json({
      error: {
        code: 'PRISM_UPSTREAM_ERROR',
        message: `The prism renderer returned HTTP ${res.status}.`,
        resolution: 'Retry the request later or render a local frame with pnpm snapshot:png.',
      },
    }, { status: 502 });
  }

  return new Response(res.body, {
    status: res.status,
    headers: {
      'Content-Type': res.headers.get('Content-Type') ?? 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    },
  });
}
