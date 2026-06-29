// Vercel streaming function: serves the splash → rotating-prism animation as ANSI
// so `curl -sN ascii-prisms.vercel.app` plays it in the terminal (the parrot.live
// pattern — the server streams escape codes, the terminal renders them). Output-only
// and looped, but FINITE: serverless functions have a max execution time, so the
// loop stops a few seconds before the cap and ends cleanly (re-run curl to replay).
//
// Color: truecolor (24-bit) by default. Terminals without 24-bit support (e.g. macOS
// Terminal.app) mis-parse `38;2;r;g;b` into garbage SGR codes (solid flickering color
// blocks), so `?colors=256` downgrades to indexed 256-color, which renders everywhere.
// curl can't report its size or color support, so `?sh` returns a bootstrap that
// detects both client-side: `curl -s 'ascii-prisms.vercel.app?sh' | sh`.
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

// RGB → nearest xterm-256 index: the 6×6×6 color cube (16–231) plus the grayscale
// ramp (232–255) for near-gray pixels. Lets non-truecolor terminals render the art.
function rgbTo256(r: number, g: number, b: number): number {
  if (Math.abs(r - g) < 8 && Math.abs(g - b) < 8 && Math.abs(r - b) < 8) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return 232 + Math.round(((r - 8) / 247) * 24);
  }
  const q = (v: number): number => Math.round((v / 255) * 5);
  return 16 + 36 * q(r) + 6 * q(g) + q(b);
}
// Rewrite truecolor fg escapes to 256-color. toShapeGlyph only emits `38;2;r;g;b`
// (foreground), so this single pass downgrades a whole frame.
const TRUECOLOR_FG = /\x1b\[38;2;(\d+);(\d+);(\d+)m/g;
function to256(frame: string): string {
  return frame.replace(TRUECOLOR_FG, (_m, r, g, b) => `\x1b[38;5;${rgbTo256(+r, +g, +b)}m`);
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');

  // `?sh` → a bootstrap script that detects terminal size + truecolor support on the
  // CLIENT (curl can't report them) and re-streams with the right flags.
  if (url.searchParams.has('sh')) {
    const host = req.headers.host ?? 'ascii-prisms.vercel.app';
    const script =
      'm=""\n' +
      'case "${COLORTERM:-}" in *truecolor*|*24bit*) ;; *) m="&colors=256" ;; esac\n' +
      `exec curl -sN "https://${host}/?cols=$(tput cols 2>/dev/null || echo 80)&rows=$(tput lines 2>/dev/null || echo 24)$m"\n`;
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(script);
    return;
  }

  const cols = clampInt(url.searchParams.get('cols') ?? url.searchParams.get('c'), 20, 220, 80);
  const rows = clampInt(url.searchParams.get('rows') ?? url.searchParams.get('r'), 10, 80, 24);
  const want256 = (url.searchParams.get('colors') ?? '') === '256';

  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
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
    let frame = toShapeGlyph(target, cols, rows, { color: true });
    if (want256) frame = to256(frame);
    if (!res.write(frame)) {
      await new Promise<void>((r) => res.once('drain', () => r())); // respect backpressure
    }
    await sleep(DT * 1000);
  }
  if (alive) res.write('\x1b[?25h'); // show cursor on graceful end
  res.end();
}
