// Stream the splash → rotating-prism animation as ANSI over HTTP, so
// `curl -sN <url>` plays it right in the terminal — the curl parrot.live pattern:
// the server streams escape codes, the terminal renders them. Output-only (no
// input), looped. Renders in the app's default shape-matched ASCII mode
// (toShapeGlyph), colored per cell — the same glyph look as the live arcade.
//
//   pnpm exec tsx src/tools/serve-prism.ts [port]
//   curl -sN "http://localhost:8080?cols=$(tput cols)&rows=$(tput lines)"
//
// curl doesn't report terminal size, so cols/rows come from the query (with a
// sensible default). This standalone server runs on any long-lived host (Fly,
// Railway, a VM) for a truly infinite stream; Vercel needs the function variant.
import { createServer } from 'node:http';
import { RenderTarget, toShapeGlyph } from '../engine/index.ts';
import { PrismScene } from '../arcade/prism.ts';
import { SplashScene, SPLASH_END } from '../arcade/splash.ts';

const PORT = Number(process.argv[2]) || 8080;
const SS = 3; // supersample factor (matches the in-app prism)
const FPS = 24;
const DT = 1 / FPS;
const PRISM_SECONDS = 9; // rotating-prism showtime after the splash, before looping back to the triangle
const CYCLE = SPLASH_END + PRISM_SECONDS;

function clampInt(v: string | null, lo: number, hi: number, dflt: number): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && v != null && v !== '' ? Math.max(lo, Math.min(hi, n)) : dflt;
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/favicon.ico') {
    res.writeHead(404).end();
    return;
  }
  // curl doesn't report terminal size, so default to the universal 80×24 (fits
  // essentially any terminal without wrapping). Size is overridable via cols/rows
  // (or the short aliases c/r), e.g. ?c=$COLUMNS&r=$LINES to fill the window.
  const cols = clampInt(url.searchParams.get('cols') ?? url.searchParams.get('c'), 20, 220, 80);
  const rows = clampInt(url.searchParams.get('rows') ?? url.searchParams.get('r'), 10, 80, 24);

  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no', // ask any proxy not to buffer the stream
  });
  res.write('\x1b[2J\x1b[?25l'); // clear screen + hide cursor

  // Per-connection state (the scenes are pure fn(t)→target, but the target buffer
  // and clock are per client so concurrent viewers don't clash).
  const splash = new SplashScene();
  const prism = new PrismScene();
  const target = new RenderTarget(cols * SS, rows * 2 * SS);
  let t = 0;
  let alive = true;

  const stop = (): void => {
    alive = false;
  };
  req.on('close', stop);
  res.on('error', stop);

  const tick = (): void => {
    if (!alive) return;
    const tt = t % CYCLE; // loop: triangle splash, then prism, then back to the triangle
    if (tt < SPLASH_END) splash.renderScene(target, tt);
    else prism.renderScene(target, tt); // splash hands off seamlessly to the live prism at SPLASH_END
    t += DT;
    // Respect backpressure: only schedule the next frame once the socket drains.
    if (res.write(toShapeGlyph(target, cols, rows, { color: true }))) setTimeout(tick, DT * 1000);
    else res.once('drain', () => setTimeout(tick, DT * 1000));
  };
  tick();
});

server.listen(PORT, () => {
  console.log(`ascii-prism streaming on http://localhost:${PORT}`);
  console.log(`try:  curl -sN http://localhost:${PORT}`);
  console.log(`fill window:  curl -sN "http://localhost:${PORT}?c=$COLUMNS&r=$LINES"`);
});
