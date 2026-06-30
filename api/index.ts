// Vercel streaming function: serves the splash → rotating-prism animation as ANSI
// so `curl -sN ascii-prisms.vercel.app` plays it in the terminal (the parrot.live
// pattern, where the server streams escape codes, the terminal renders them). Output-only
// and looped, but FINITE: serverless functions have a max execution time, so the
// loop stops a few seconds before the cap and ends cleanly (re-run curl to replay).
//
// Clients:
//   • curl / wget        → the raw ANSI stream (default).
//   • a browser (Mozilla UA) → an HTML page running xterm.js that consumes the SAME
//     stream and renders the identical animation full-screen, looping forever.
//   • ?stream            → force the raw stream (used by the browser page's fetch).
//
// Color: 256-color by DEFAULT so it renders in any terminal. Terminals without
// 24-bit support (e.g. macOS Terminal.app pre-26) mis-parse `38;2;r;g;b` into garbage
// SGR (solid flickering blocks). Add `?truecolor=1` for smooth 24-bit color where the
// terminal supports it (the browser/xterm page always requests it).
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
const TOTAL = Math.max(1, Math.round(CYCLE * FPS)); // frames in one deterministic loop

// The animation is identical for everyone at a given size + color mode, so render each
// frame once and cache it per (cols, rows, mode); every other viewer (and every
// concurrent viewer on the same warm instance) just replays the cached strings. That
// turns a CPU-bound stream into an I/O-bound one — what lets a traffic spike fan out
// cheaply. Bounded to CACHE_MAX size/mode keys with simple oldest-first eviction.
const CACHE_MAX = 24;
const sceneCache = new Map<string, string[]>();
function getFrameArray(cols: number, rows: number, truecolor: boolean): string[] {
  const key = `${cols}x${rows}x${truecolor ? 'tc' : '256'}`;
  let arr = sceneCache.get(key);
  if (!arr) {
    arr = new Array(TOTAL); // lazily filled as frames are first rendered
    sceneCache.set(key, arr);
    if (sceneCache.size > CACHE_MAX) {
      const oldest = sceneCache.keys().next().value;
      if (oldest !== undefined) sceneCache.delete(oldest);
    }
  }
  return arr;
}

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
// toShapeGlyph only emits `38;2;r;g;b` (foreground), so one pass downgrades a frame.
const TRUECOLOR_FG = /\x1b\[38;2;(\d+);(\d+);(\d+)m/g;
function to256(frame: string): string {
  return frame.replace(TRUECOLOR_FG, (_m, r, g, b) => `\x1b[38;5;${rgbTo256(+r, +g, +b)}m`);
}

// A bottom-centered status hint that gently "breathes" (per the shared clock `t`):
// a sine pulse in PURE GRAY over the last row, always faintly visible, never a hard
// cutoff. Gray is the trick: in 256-color it maps to the 24-step grayscale ramp, so
// the pulse stays smooth + neutral, instead of a tinted value snapping between cube
// colors (which looked blue and choppy). Emits truecolor; the caller's to256 pass
// downgrades it alongside the frame.
function statusHint(prefix: string, url: string, suffix: string, cols: number, rows: number, t: number): string {
  const width = prefix.length + url.length + suffix.length;
  if (cols < width + 2) return '';
  const pulse = 0.5 + 0.5 * Math.sin(t * 2.5); // ~2.5s period
  // Stay in the bright range (light-grey to near-white): 256-color's gray ramp is only
  // 24 coarse steps, and a step reads as banding/wobble in the dark (large relative
  // change) but is nearly invisible up near white, so the pulse stays clean.
  const v = Math.round(150 + 95 * pulse); // gray 150..245
  const col = Math.floor((cols - width) / 2) + 1;
  const gray = `\x1b[38;2;${v};${v};${v}m`;
  // Only the URL is underlined + an OSC 8 hyperlink (clickable in terminals that
  // support it: iTerm2, Ghostty, WezTerm, kitty, VS Code…); the rest is plain text.
  return `\x1b[${rows};${col}H${gray}${prefix}\x1b]8;;${url}\x07\x1b[4m${url}\x1b[24m\x1b]8;;\x07${suffix}\x1b[0m`;
}

// Plain-text options page (curl …/help).
function helpText(host: string): string {
  const site = 'https://' + host;
  // Only the bare site URL is an explicit OSC 8 hyperlink (underlined + clickable) —
  // opening it in a browser is meaningful. The query-param commands below are left as
  // plain text (clicking them does nothing useful in the browser, which ignores the
  // cols/rows/truecolor params). Any partial underline a terminal still shows on those
  // is its own URL auto-detection, which the server can't turn off.
  const link = (u: string): string => `\x1b]8;;${u}\x07\x1b[4m${u}\x1b[24m\x1b]8;;\x07`;
  return [
    '',
    '  \x1b[1mascii-prisms\x1b[0m: curl an animated prism in your terminal',
    '',
    '  curl -sN ' + link(site),
    '      play it. 80x24, 256-color (works in any terminal)',
    '',
    '  curl -sN "' + site + '?cols=$(tput cols)&rows=$(tput lines)"',
    '      fill your terminal window',
    '',
    '  curl -sN "' + site + '?truecolor=1"',
    '      smoother 24-bit color, for truecolor terminals (iTerm2, Ghostty,',
    '      WezTerm, kitty, VS Code, Cursor, macOS Terminal 26+)',
    '',
    '  curl -sN "' + site + '?cols=$(tput cols)&rows=$(tput lines)&truecolor=1"',
    '      truecolor, filling your window',
    '',
    '  open ' + link(site) + ' in a browser to watch it there too.',
    '',
    '',
  ].join('\n');
}

// The browser page: an xterm.js terminal fitted to the window that streams the same
// `/?stream` ANSI and renders it, reconnecting (looping) when the finite stream ends.
// An ⓘ button (top-right) opens a modal listing the curl commands (click to copy).
function browserHtml(host: string): string {
  // Favicon: the Vercel triangle, inlined as a data-URI SVG (no extra route/request).
  // The media query flips it black on light tabs, white on dark tabs.
  const favicon =
    'data:image/svg+xml;base64,' +
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1155 1000">' +
        '<style>path{fill:#000}@media(prefers-color-scheme:dark){path{fill:#fff}}</style>' +
        '<path d="M577.3 0 1155 1000H0z"/></svg>',
    ).toString('base64');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ascii-prisms</title>
<link rel="icon" type="image/svg+xml" href="${favicon}">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.min.css">
<style>
  html,body{margin:0;height:100%;background:#000;overflow:hidden;
            font:13px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
  #t{position:fixed;inset:0}
  #info{position:fixed;top:16px;left:18px;z-index:3;background:none;border:0;padding:6px;
        color:#eef1f6;opacity:.9;cursor:pointer;line-height:0;text-decoration:none;transition:opacity .15s}
  #info:hover{opacity:1}
  #info svg{display:block}
  #modal[hidden]{display:none}
  #modal{position:fixed;inset:0;z-index:4;display:flex;align-items:center;justify-content:center;
         background:rgba(0,0,0,.6);backdrop-filter:blur(4px)}
  #card{width:min(740px,94vw);background:#0e1117;border:1px solid #262b36;border-radius:14px;
        padding:22px 22px 18px;box-shadow:0 24px 70px rgba(0,0,0,.55);color:#d7dbe6}
  #head{display:flex;justify-content:space-between;align-items:center;margin-bottom:4px}
  #head span{font-size:13px;color:#9aa3b4;letter-spacing:.03em}
  #note{font-size:11.5px;color:#6b7382;line-height:1.55;margin:2px 0 2px}
  #note b{color:#aeb6c6;font-weight:600}
  #close{background:none;border:0;color:#7b8395;font-size:19px;cursor:pointer;line-height:1;
         padding:2px 7px;border-radius:7px;transition:.12s}
  #close:hover{color:#fff;background:#1a1f29}
  .cmd{margin:14px 0}
  .lbl{font-size:12px;color:#7b8395;margin-bottom:6px}
  .cmd code{display:block;padding:10px 12px;background:#07090d;border:1px solid #20252f;border-radius:8px;
            color:#e6e9f0;font-size:12px;white-space:nowrap;overflow-x:auto;cursor:pointer;
            transition:border-color .15s,background .15s}
  .cmd code::-webkit-scrollbar{height:0}
  .cmd code:hover{border-color:#39414f;background:#0a0d12}
  .cmd code.copied{border-color:#3f8c63;background:#0a0f0b}
  #tip{margin-top:16px;font-size:11px;color:#5a6172;text-align:center}
  #toast{position:fixed;left:50%;bottom:30px;transform:translate(-50%,8px);z-index:5;
         background:#1a1f29;border:1px solid #2f3744;color:#cdd3df;font-size:12px;
         padding:8px 14px;border-radius:9px;opacity:0;pointer-events:none;
         transition:opacity .18s,transform .18s;box-shadow:0 10px 30px rgba(0,0,0,.45)}
  #toast.show{opacity:1;transform:translate(-50%,0)}
  .xterm .xterm-viewport{overflow:hidden!important}
</style>
</head>
<body>
<div id="t"></div>
<a id="info" href="/help" title="commands" aria-label="commands"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg></a>
<div id="modal" hidden>
  <div id="card">
    <div id="head"><span>ascii-prisms: curl it</span><button id="close" aria-label="close">&times;</button></div>
    <div id="note">Works in any terminal by default (256-color). Add <b>&amp;truecolor=1</b> for smoother 24-bit color if your terminal supports it: iTerm2, Ghostty, WezTerm, kitty, VS&nbsp;Code, Cursor, or macOS&nbsp;Terminal on&nbsp;26+.</div>
    <div class="cmd"><div class="lbl">Play it in your terminal (80&times;24)</div><code>curl -sN https://${host}</code></div>
    <div class="cmd"><div class="lbl">Fill your window</div><code>curl -sN "https://${host}?cols=$(tput cols)&amp;rows=$(tput lines)"</code></div>
    <div class="cmd"><div class="lbl">Truecolor (richer 24-bit color)</div><code>curl -sN "https://${host}?truecolor=1"</code></div>
    <div class="cmd"><div class="lbl">Truecolor, filling your window</div><code>curl -sN "https://${host}?cols=$(tput cols)&amp;rows=$(tput lines)&amp;truecolor=1"</code></div>
    <div id="tip">click any command to copy</div>
  </div>
</div>
<div id="toast">Copied</div>
<script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.min.js"></script>
<script>
  var term = new Terminal({ disableStdin:true, scrollback:0, fontSize:13,
    fontFamily:'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace', theme:{ background:'#000000' } });
  var fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(document.getElementById('t'));
  fit.fit();
  var ctrl;
  async function run(){
    fit.fit();
    ctrl = new AbortController();
    var res = await fetch('/?stream&web=1&truecolor=1&cols=' + term.cols + '&rows=' + term.rows, { signal: ctrl.signal });
    var reader = res.body.getReader();
    var dec = new TextDecoder();
    for(;;){ var r = await reader.read(); if (r.done) break; term.write(dec.decode(r.value, { stream:true })); }
  }
  (async function(){ for(;;){ try { await run(); } catch (e) {} await new Promise(function(r){ setTimeout(r, 60); }); } })();
  var rt; addEventListener('resize', function(){ clearTimeout(rt); rt = setTimeout(function(){ try { ctrl && ctrl.abort(); } catch (e) {} }, 150); });

  var modal = document.getElementById('modal');
  function showModal(v){ modal.hidden = !v; }
  function openHelp(){ showModal(true); if (location.pathname !== '/help') history.pushState({}, '', '/help'); }
  function closeHelp(){ showModal(false); if (location.pathname === '/help') history.pushState({}, '', '/'); }
  document.getElementById('info').onclick = function(e){ e.preventDefault(); openHelp(); };
  document.getElementById('close').onclick = closeHelp;
  modal.onclick = function(e){ if (e.target === modal) closeHelp(); };
  addEventListener('keydown', function(e){ if (e.key === 'Escape') closeHelp(); });
  addEventListener('popstate', function(){ showModal(location.pathname === '/help'); }); // back/forward sync
  if (location.pathname === '/help') showModal(true); // direct load / shared link opens it
  var toast = document.getElementById('toast'), tt;
  function popToast(){
    toast.classList.remove('show');
    void toast.offsetWidth; // force reflow so the enter animation replays on every copy
    toast.classList.add('show');
    clearTimeout(tt); tt = setTimeout(function(){ toast.classList.remove('show'); }, 1100);
  }
  Array.prototype.forEach.call(document.querySelectorAll('#modal code'), function(c){
    c.onclick = function(){
      try { navigator.clipboard.writeText(c.textContent); } catch (e) {}
      c.classList.remove('copied');
      void c.offsetWidth; // re-flash the green border even on repeat / rapid clicks
      c.classList.add('copied');
      setTimeout(function(){ c.classList.remove('copied'); }, 900);
      popToast();
    };
  });
</script>
</body>
</html>`;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const ua = (req.headers['user-agent'] ?? '').toLowerCase();
  const host = req.headers.host ?? 'ascii-prisms.vercel.app';

  const isBrowser = ua.includes('mozilla') && !url.searchParams.has('stream');
  const isHelp = url.pathname === '/help' || url.searchParams.has('help');

  // A browser gets the HTML page for ANY path, including /help, where the page's JS
  // opens the ⓘ modal on load, so the help URL works whether clicked, shared, or reloaded.
  // NOTE: these responses are content-negotiated by User-Agent (browser → HTML,
  // curl → stream/text), and the CDN keys by URL not UA — so they must NOT be
  // edge-cached, or a browser hit would poison `/` and serve HTML to curl.
  if (isBrowser) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(browserHtml(host));
    return;
  }
  // curl /help → plain-text options.
  if (isHelp) {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(helpText(host));
    return;
  }

  const cols = clampInt(url.searchParams.get('cols') ?? url.searchParams.get('c'), 20, 220, 80);
  const rows = clampInt(url.searchParams.get('rows') ?? url.searchParams.get('r'), 10, 80, 24);
  // 256-color by default (works anywhere); opt into 24-bit with ?truecolor (or =1).
  const truecolor = url.searchParams.has('truecolor') && url.searchParams.get('truecolor') !== '0';
  // The breathing "/help" hint is for terminals; the browser page (?web) has the ⓘ modal.
  // It gets its OWN reserved bottom row (the prism renders one row shorter), so the
  // scene never overdraws it; that double-paint was the flicker.
  const showHint = !url.searchParams.has('web');
  const hintUrl = `https://${host}/help`;
  const sceneRows = showHint ? rows - 1 : rows;

  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
  });
  res.write('\x1b[2J\x1b[?25l'); // clear screen + hide cursor

  const frames = getFrameArray(cols, sceneRows, truecolor); // shared cache, filled on demand
  // Scene/target allocated only on a cache miss — cached viewers never touch them.
  let target: RenderTarget | undefined;
  let splash: SplashScene | undefined;
  let prism: PrismScene | undefined;
  let i = 0; // frame index, wraps over the loop
  let hintT = 0; // continuous clock for the hint's pulse (kept smooth across loop wraps)
  let alive = true;
  req.on('close', () => {
    alive = false;
  });

  const deadline = Date.now() + STREAM_SECONDS * 1000;
  while (alive && Date.now() < deadline) {
    let frame = frames[i];
    if (frame === undefined) {
      if (!target) {
        target = new RenderTarget(cols * SS, sceneRows * 2 * SS);
        splash = new SplashScene();
        prism = new PrismScene();
      }
      const tt = (i / FPS) % CYCLE; // loop: triangle splash, then prism, then back to the triangle
      if (tt < SPLASH_END) splash!.renderScene(target, tt);
      else prism!.renderScene(target, tt); // splash hands off seamlessly to the live prism
      frame = toShapeGlyph(target, cols, sceneRows, { color: true });
      if (!truecolor) frame = to256(frame); // default → 256-color (renders in any terminal)
      frames[i] = frame; // cache for every other viewer at this size/mode
    }
    let out = frame;
    if (showHint) {
      // Hint is appended fresh each frame (it breathes); convert it to 256 separately
      // since the cached frame is already in its final color.
      let h = statusHint('visit or curl ', hintUrl, ' for options', cols, rows, hintT);
      if (h && !truecolor) h = to256(h);
      out += h;
    }
    if (!res.write(out)) {
      await new Promise<void>((r) => res.once('drain', () => r())); // respect backpressure
    }
    i = (i + 1) % TOTAL;
    hintT += DT;
    await sleep(DT * 1000);
  }
  if (alive) res.write('\x1b[?25h'); // show cursor on graceful end
  res.end();
}
