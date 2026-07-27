// Landing page for the proxy root (and any non-ingest path). The three /v1/* ingest
// routes are matched first; everything else falls through here so a browser hitting
// arcade-telemetry.vercel.app sees a transparency page instead of a 404. It states
// exactly what the proxy forwards and what it never collects — the privacy story the
// CLI makes, served from the trust boundary itself. Content-negotiated like the prism:
// a browser gets HTML, curl/others get plain text. No deps, no downstream calls.
import type { IncomingMessage, ServerResponse } from 'node:http';

const REPO = 'https://github.com/vercel-labs/arcade';

const ROUTES: [string, string][] = [
  ['POST /v1/events', 'product / session events'],
  ['POST /v1/matches', 'canonical chess & poker match records'],
  ['POST /v1/poker-hands', 'complete poker hand records'],
];
const NEVER = 'prompts, reasoning, chat, voice, or account identity';
const OPT_OUT = ['ARCADE_TELEMETRY=0', 'arcade telemetry disable', 'the home-menu toggle'];

function textPage(): string {
  return [
    'Arcade Telemetry',
    '================',
    '',
    'Anonymous telemetry proxy for Arcade — a terminal ASCII arcade of AI-vs-AI games.',
    'It validates gameplay records and forwards them to Tinybird to power a public model',
    'leaderboard. The published CLI ships no credentials; this proxy is the trust boundary.',
    '',
    `Never collected: ${NEVER}.`,
    '',
    'Endpoints (NDJSON body):',
    ...ROUTES.map(([r, d]) => `  ${r.padEnd(22)} ${d}`),
    '',
    `Opt out anytime:  ${OPT_OUT.join('   ·   ')}`,
    '',
    `Source: ${REPO}  (src/telemetry, apps/telemetry-proxy)`,
    '',
  ].join('\n');
}

function htmlPage(): string {
  const rows = ROUTES.map(([r, d]) => `<tr><td><code>${r}</code></td><td>${d}</td></tr>`).join('');
  const opts = OPT_OUT.map((o) => `<code>${o.replace(/</g, '&lt;')}</code>`).join('<span class="sep">·</span>');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Arcade Telemetry</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  html,body{margin:0;min-height:100%;background:#000;
    font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
  body{display:flex;align-items:center;justify-content:center;padding:28px}
  #card{width:min(680px,96vw);background:#0e1117;border:1px solid #262b36;border-radius:14px;
    padding:26px 26px 22px;box-shadow:0 24px 70px rgba(0,0,0,.55);color:#d7dbe6}
  h1{font-size:18px;margin:0 0 2px;color:#eef1f6;letter-spacing:.02em}
  .tag{font-size:12px;color:#9aa3b4;margin:0 0 18px}
  p{font-size:13px;line-height:1.6;color:#c2c8d4;margin:0 0 14px}
  .never{background:#151a22;border:1px solid #23303a;border-radius:9px;padding:11px 13px;margin:0 0 18px}
  .never b{color:#8fd39a;font-weight:600}
  .lbl{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#6b7382;margin:0 0 8px}
  table{width:100%;border-collapse:collapse;margin:0 0 18px;font-size:12.5px}
  td{padding:5px 0;border-bottom:1px solid #1b212b;color:#aeb6c6;vertical-align:top}
  td:first-child{width:190px;white-space:nowrap}
  code{color:#e3e7ef;background:#191f28;border:1px solid #232a35;border-radius:5px;padding:1px 6px;font-size:12px}
  .opts{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0 0 20px}
  .sep{color:#3b414d;margin:0 2px}
  a{color:#8ea2ff;text-decoration:none}
  a:hover{text-decoration:underline}
  .foot{font-size:12px;color:#6b7382;border-top:1px solid #1b212b;padding-top:14px}
</style>
</head>
<body>
  <div id="card">
    <h1>Arcade Telemetry</h1>
    <p class="tag">the anonymous telemetry proxy for <a href="${REPO}">Arcade</a> — a terminal ASCII arcade of AI-vs-AI games</p>
    <p>This endpoint validates anonymous gameplay records and forwards them to power a public model leaderboard. The published CLI ships <b>no credentials</b>; this proxy is the trust boundary that re-checks every record and holds the only append token.</p>
    <div class="never">Never collected: <b>${NEVER}</b>.</div>
    <div class="lbl">Endpoints</div>
    <table>${rows}</table>
    <div class="lbl">Opt out anytime</div>
    <div class="opts">${opts}</div>
    <div class="foot">Source &amp; privacy details: <a href="${REPO}">${REPO.replace('https://', '')}</a></div>
  </div>
</body>
</html>
`;
}

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: 'method_not_allowed' }));
    return;
  }
  const accept = (req.headers.accept ?? '').toLowerCase();
  const ua = (req.headers['user-agent'] ?? '').toLowerCase();
  const wantsHtml = accept.includes('text/html') || ua.includes('mozilla');
  res.statusCode = 200;
  // Negotiated by User-Agent but the CDN keys by URL, so it must not be edge-cached —
  // a browser hit would otherwise poison `/` and serve HTML to curl (see the prism).
  res.setHeader('cache-control', 'no-store');
  if (wantsHtml) {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(req.method === 'HEAD' ? '' : htmlPage());
  } else {
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end(req.method === 'HEAD' ? '' : textPage());
  }
}
