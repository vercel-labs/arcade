// Vercel streaming function: serves the splash → rotating-prism animation as ANSI
// so `curl -sN ascii-prisms.vercel.app` plays it in the terminal (the parrot.live
// pattern — the server streams escape codes, the terminal renders them). Output-only
// and looped, but FINITE: serverless functions have a max execution time, so the
// loop stops a few seconds before the cap and ends cleanly (re-run curl to replay).
// Pass ?cols=&rows= (or c/r) to fill the window. Mirrors src/tools/serve-prism.ts.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { RenderTarget, toShapeGlyph } from '../src/engine/index.ts';
import { PrismScene } from '../src/arcade/prism.ts';
import { SplashScene, SPLASH_END } from '../src/arcade/splash.ts';

const SS = 3; // supersample factor (matches the in-app prism)
const FPS = 24;
const DT = 1 / FPS;
const PRISM_SECONDS = 9; // rotating-prism showtime after the splash, before looping back to the triangle
const CYCLE = SPLASH_END + PRISM_SECONDS;
const STREAM_SECONDS = 290; // stop just before maxDuration so the client gets a clean end

function clampInt(v: string | null, lo: number, hi: number, dflt: number): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && v != null && v !== '' ? Math.max(lo, Math.min(hi, n)) : dflt;
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  // curl sends no terminal size → default to the universal 80×24 (fits any terminal);
  // ?cols=&rows= (or short c/r) fill the window, e.g. ?cols=$(tput cols)&rows=$(tput lines).
  const cols = clampInt(url.searchParams.get('cols') ?? url.searchParams.get('c'), 20, 220, 80);
  const rows = clampInt(url.searchParams.get('rows') ?? url.searchParams.get('r'), 10, 80, 24);

  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no', // ask the proxy not to buffer the stream
  });
  res.write('\x1b[2J\x1b[?25l'); // clear screen + hide cursor

  const splash = new SplashScene();
  const prism = new PrismScene();
  const target = new RenderTarget(cols * SS, rows * 2 * SS);
  let t = 0;
  let alive = true;
  req.on('close', () => {
    alive = false;
  });

  const deadline = Date.now() + STREAM_SECONDS * 1000;
  while (alive && Date.now() < deadline) {
    const tt = t % CYCLE; // loop: triangle splash, then prism, then back to the triangle
    if (tt < SPLASH_END) splash.renderScene(target, tt);
    else prism.renderScene(target, tt); // splash hands off seamlessly to the live prism at SPLASH_END
    t += DT;
    if (!res.write(toShapeGlyph(target, cols, rows, { color: true }))) {
      await new Promise<void>((r) => res.once('drain', () => r())); // respect backpressure
    }
    await sleep(DT * 1000);
  }
  if (alive) res.write('\x1b[?25h'); // show cursor on graceful end
  res.end();
}
