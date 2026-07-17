// Print the model-compatibility report(s) written by model-compat-report.ts. OFFLINE
// (no network) — a quick reference for which models are safe to include, which support
// structured output vs only prose, which have access issues, and which are exclusive to
// a particular Vercel team. Reads every `docs/model-compat.<team-slug>.json` it finds.
//
//   pnpm models:report                     # ≥2 teams → cross-team matrix; else detailed
//   pnpm models:report --team=<slug>       # one team, detailed per-game table
//   pnpm models:report --matrix            # force the cross-team matrix
//   pnpm models:report --only=fail         # only models that aren't cleanly playable
//   pnpm models:report --status=ACCESS,TEXT
//   pnpm models:report --game=poker        # focus one game
//   pnpm models:report --sort=slow         # slowest move first (single-team view)
//   pnpm models:report --md[=docs/model-compat.md]   # also write a combined markdown ref
//   pnpm models:report --html[=docs/model-compat.html]  # write a styled, interactive HTML report
//
// Generate the underlying data with:  pnpm models:audit [all|sweep|<creator>] [--team=<slug>]

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

type Status = 'STRUCTURED' | 'TEXT' | 'NORMALIZED' | 'FALLBACK' | 'ACCESS' | 'TIMEOUT' | 'ERROR';
type GameKind = 'chess' | 'poker';
interface GameResult {
  status: Status;
  structured: 'yes' | 'no' | '—';
  move: string;
  ms: number;
  detail: string;
}
interface Row {
  id: string;
  name: string;
  chess?: GameResult;
  poker?: GameResult;
}
interface Report {
  generatedAt: string;
  team: { name: string; slug: string };
  normalizer: string | null;
  timeoutMs: number;
  games: GameKind[];
  models: Row[];
}

const PLAYABLE = new Set<Status>(['STRUCTURED', 'TEXT', 'NORMALIZED']);
const SEVERITY: Status[] = ['ERROR', 'FALLBACK', 'ACCESS', 'TIMEOUT', 'NORMALIZED', 'TEXT', 'STRUCTURED'];

// ── colour ────────────────────────────────────────────────────────────────────────
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const sgr = (code: string, s: string): string => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = (s: string): string => sgr('32', s);
const yellow = (s: string): string => sgr('33', s);
const cyan = (s: string): string => sgr('36', s);
const red = (s: string): string => sgr('31', s);
const magenta = (s: string): string => sgr('35', s);
const dim = (s: string): string => sgr('2', s);
const bold = (s: string): string => sgr('1', s);

// Per-status presentation: a one-letter matrix glyph and a colouriser.
const STYLE: Record<Status, { glyph: string; color: (s: string) => string }> = {
  STRUCTURED: { glyph: 'S', color: green },
  TEXT: { glyph: 'T', color: yellow },
  NORMALIZED: { glyph: 'N', color: cyan },
  FALLBACK: { glyph: 'F', color: red },
  ACCESS: { glyph: 'A', color: magenta },
  TIMEOUT: { glyph: '·', color: dim },
  ERROR: { glyph: 'x', color: red },
};
const statusLabel = (s?: Status): string => (s ? STYLE[s].color(s) : dim('—'));
const glyph = (s?: Status): string => (s ? STYLE[s].color(STYLE[s].glyph) : dim('-'));

// Move latency, coloured by gameplay feel: green <10s · yellow 10–20s · red ≥20s.
const SLOW_MS = 20_000;
const secs = (ms?: number): string => (ms == null ? dim('—') : `${(ms / 1000).toFixed(1)}s`);
const speed = (ms?: number): ((s: string) => string) =>
  ms == null ? dim : ms >= SLOW_MS ? red : ms >= 10_000 ? yellow : green;
const worstMs = (m: Row, gs: GameKind[]): number =>
  Math.max(0, ...gs.map((g) => m[g]?.ms ?? 0));
const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
};

// Visible width (ignoring SGR codes), for padding coloured cells.
const plain = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');
const pad = (s: string, w: number): string => s + ' '.repeat(Math.max(0, w - plain(s).length));

// ── args ──────────────────────────────────────────────────────────────────────────
const arg = (name: string): string | undefined => {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  return hit === undefined ? undefined : hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : '';
};
const has = (name: string): boolean => arg(name) !== undefined;
const DIR = arg('dir') ?? 'docs';
const TEAM = arg('team');
const ONLY = arg('only'); // 'fail' | 'ok'
const GAME = arg('game') as GameKind | undefined;
const STATUS_FILTER = arg('status')?.split(',').map((s) => s.trim().toUpperCase()) as Status[] | undefined;
const FORCE_MATRIX = has('matrix');
const SORT = arg('sort'); // 'slow' → slowest move first

function loadReports(): Report[] {
  const files = process.argv.filter((a) => a.endsWith('.json') && !a.startsWith('--'));
  const paths = files.length ? files : readdirSync(DIR).filter((f) => /^model-compat\..+\.json$/.test(f)).map((f) => `${DIR}/${f}`);
  const reports: Report[] = [];
  for (const p of paths) {
    try {
      reports.push(JSON.parse(readFileSync(p, 'utf8')) as Report);
    } catch (e) {
      console.error(dim(`skipping ${p}: ${(e as Error).message}`));
    }
  }
  return reports.sort((a, b) => a.team.slug.localeCompare(b.team.slug));
}

const games = (r: Report): GameKind[] => (GAME ? r.games.filter((g) => g === GAME) : r.games);
const worst = (row: Row, gs: GameKind[]): Status | undefined => {
  const statuses = gs.map((g) => row[g]?.status).filter((s): s is Status => Boolean(s));
  return SEVERITY.find((s) => statuses.includes(s));
};
const rowPlayable = (row: Row, gs: GameKind[]): boolean => gs.some((g) => PLAYABLE.has(row[g]?.status ?? ('' as Status)));

function keepRow(row: Row, gs: GameKind[]): boolean {
  if (STATUS_FILTER && !gs.some((g) => row[g] && STATUS_FILTER.includes(row[g]!.status))) return false;
  if (ONLY === 'fail' && rowPlayable(row, gs)) return false;
  if (ONLY === 'ok' && !rowPlayable(row, gs)) return false;
  return true;
}

// ── single-team detailed table ──────────────────────────────────────────────────────
function renderSingle(r: Report): string[] {
  const gs = games(r);
  const out: string[] = [];
  out.push(bold(`Model compatibility · ${r.team.name} (${r.team.slug})`));
  out.push(dim(`generated ${r.generatedAt.slice(0, 10)} · games ${gs.join('+')} · normalizer ${r.normalizer ?? '(disabled)'} · ${r.timeoutMs / 1000}s timeout`));
  out.push('');

  // Summary counts + latency per game.
  for (const g of gs) {
    const counts = SEVERITY.map((s) => ({ s, n: r.models.filter((m) => m[g]?.status === s).length })).filter((c) => c.n);
    const playable = r.models.filter((m) => PLAYABLE.has(m[g]?.status ?? ('' as Status))).length;
    // Latency stats over playable models only (failed/blocked calls aren't a move time).
    const lat = r.models.filter((m) => PLAYABLE.has(m[g]?.status ?? ('' as Status))).map((m) => m[g]?.ms ?? 0);
    const slow = lat.filter((ms) => ms >= SLOW_MS).length;
    const latStr = lat.length ? `${dim('median')} ${secs(median(lat))} · ${dim('slowest')} ${speed(Math.max(...lat))(secs(Math.max(...lat)))} · ${slow >= 1 ? red(`${slow} ≥${SLOW_MS / 1000}s`) : dim('0 slow')}` : '';
    out.push(`  ${bold(g.padEnd(6))} ${green(`${playable}/${r.models.length} playable`)}   ${counts.map((c) => `${STYLE[c.s].color(c.s)} ${c.n}`).join('  ')}   ${latStr}`);
  }
  out.push('');
  out.push(dim('  legend: STRUCTURED=native JSON · TEXT=prose-parsed · NORMALIZED=2nd-LLM · FALLBACK=random · ACCESS=team blocked · TIMEOUT/ERROR'));
  out.push(dim(`  latency (per move): ${green('<10s')} · ${yellow('10–20s')} · ${red(`≥${SLOW_MS / 1000}s (sluggish for gameplay)`)}`));
  out.push('');

  const bySeverity = (a: Row, b: Row) => SEVERITY.indexOf(worst(a, gs) ?? 'STRUCTURED') - SEVERITY.indexOf(worst(b, gs) ?? 'STRUCTURED') || a.id.localeCompare(b.id);
  const bySlow = (a: Row, b: Row) => worstMs(b, gs) - worstMs(a, gs) || a.id.localeCompare(b.id);
  const rows = r.models.filter((m) => keepRow(m, gs)).sort(SORT === 'slow' ? bySlow : bySeverity);
  const idW = Math.max(5, ...rows.map((m) => m.id.length));
  const gameW = 22;
  const header = `  ${pad(bold('MODEL'), idW)}  ${pad(bold('STRUCT'), 6)}  ${gs.map((g) => pad(bold(g.toUpperCase()), gameW)).join('  ')}  ${bold('NOTES')}`;
  out.push(header);
  for (const m of rows) {
    const struct = m.chess?.structured ?? m.poker?.structured ?? '—';
    const structCell = struct === 'yes' ? green('yes') : struct === 'no' ? yellow('no ') : dim('—  ');
    const cells = gs.map((g) => {
      const gr = m[g];
      const time = gr && PLAYABLE.has(gr.status) ? ' ' + speed(gr.ms)(secs(gr.ms)) : '';
      return pad(`${statusLabel(gr?.status)}${gr?.move ? ' ' + dim(gr.move) : ''}${time}`, gameW);
    }).join('  ');
    const detail = gs.map((g) => m[g]?.detail).find(Boolean) ?? '';
    const ms = worstMs(m, gs);
    const slowTag = rowPlayable(m, gs) && ms >= SLOW_MS ? red(`slow ${secs(ms)}`) : '';
    const note = [slowTag, dim(detail.slice(0, 70))].filter(Boolean).join(' ');
    out.push(`  ${pad(m.id, idW)}  ${pad(structCell, 6)}  ${cells}  ${note}`);
  }
  if (!rows.length) out.push(dim('  (no models match the current filters)'));
  return out;
}

// ── cross-team matrix ───────────────────────────────────────────────────────────────
function availability(id: string, reports: Report[], g: GameKind): { label: string; color: (s: string) => string } {
  const rele = reports.filter((r) => r.games.includes(g));
  if (!rele.length) return { label: 'n/a', color: dim };
  const on = rele.filter((r) => PLAYABLE.has(r.models.find((m) => m.id === id)?.[g]?.status ?? ('' as Status)));
  if (!on.length) return { label: 'none', color: red };
  if (on.length === rele.length) return { label: 'public', color: green };
  if (on.length === 1) return { label: `exclusive:${on[0].team.slug}`, color: magenta };
  return { label: `partial (${on.length}/${rele.length})`, color: yellow };
}

function renderMatrix(reports: Report[]): string[] {
  const gs = GAME ? [GAME] : (['chess', 'poker'] as GameKind[]).filter((g) => reports.some((r) => r.games.includes(g)));
  const primary = gs[0];
  const out: string[] = [];
  out.push(bold(`Model compatibility matrix · ${reports.length} teams · games ${gs.join('+')}`));
  for (const r of reports) out.push(dim(`  ${r.team.slug.padEnd(34)} ${r.team.name}  (${r.generatedAt.slice(0, 10)}, ${r.models.length} models)`));
  out.push('');
  out.push(dim(`  cell = ${gs.map((g) => g[0]).join('')} status glyph:  ${SEVERITY.map((s) => `${STYLE[s].color(STYLE[s].glyph)}=${s}`).join('  ')}`));
  out.push(dim(`  AVAIL is for ${bold(primary)}: ${green('public')}=all teams · ${yellow('partial')}=some · ${magenta('exclusive')}=one · ${red('none')}`));
  out.push('');

  // Union of model ids across reports.
  const ids = [...new Set(reports.flatMap((r) => r.models.map((m) => m.id)))].sort();
  const byTeam = reports.map((r) => ({ r, map: new Map(r.models.map((m) => [m.id, m])) }));

  // Filter rows by the active filters, evaluated against the primary team's data (or any).
  const rows = ids.filter((id) => {
    const anyRow = byTeam.map((t) => t.map.get(id)).find(Boolean);
    return anyRow ? keepRow(anyRow, gs) : false;
  });

  const idW = Math.max(5, ...rows.map((id) => id.length));
  const teamW = Math.max(6, ...reports.map((r) => r.team.slug.length));
  const header = `  ${pad(bold('MODEL'), idW)}  ${reports.map((t) => pad(bold(t.team.slug), teamW)).join('  ')}  ${bold('AVAIL')}`;
  out.push(header);
  for (const id of rows) {
    const cells = byTeam.map(({ map }) => {
      const row = map.get(id);
      const cell = gs.map((g) => glyph(row?.[g]?.status)).join('');
      return pad(cell, teamW);
    });
    const av = availability(id, reports, primary);
    out.push(`  ${pad(id, idW)}  ${cells.join('  ')}  ${av.color(av.label)}`);
  }
  if (!rows.length) out.push(dim('  (no models match the current filters)'));

  // Availability summary for the primary game.
  out.push('');
  const tally = { public: 0, partial: 0, exclusive: 0, none: 0 } as Record<string, number>;
  for (const id of ids) {
    const l = availability(id, reports, primary).label;
    tally[l.startsWith('exclusive') ? 'exclusive' : l.startsWith('partial') ? 'partial' : l] = (tally[l.startsWith('exclusive') ? 'exclusive' : l.startsWith('partial') ? 'partial' : l] ?? 0) + 1;
  }
  out.push(`  ${bold(primary)} availability: ${green(`public ${tally.public}`)}  ${yellow(`partial ${tally.partial}`)}  ${magenta(`exclusive ${tally.exclusive}`)}  ${red(`none ${tally.none}`)}`);
  return out;
}

// ── markdown (combined, for committing) ─────────────────────────────────────────────
function toMarkdown(reports: Report[]): string {
  const strip = (lines: string[]): string => lines.map(plain).join('\n');
  const parts: string[] = ['# Arcade model compatibility', ''];
  if (reports.length > 1) {
    parts.push('```', strip(renderMatrix(reports)), '```', '');
  }
  for (const r of reports) parts.push('```', strip(renderSingle(r)), '```', '');
  return parts.join('\n');
}

// ── HTML report (self-contained, interactive) ───────────────────────────────────────
// A status matrix (each cell is a state, not a series), so it uses the reserved status
// palette + a neutral for ACCESS. Every cell carries a letter + label + tooltip, never
// colour alone; there is a legend and it is inherently a table — the mitigations the
// data-viz method requires for a sub-3:1 status palette. Text stays ink; colour rides a
// dot + a light tint. Light/dark via CSS vars + a toggle.
const STATUS_META: Record<Status, { letter: string; label: string; note: string }> = {
  STRUCTURED: { letter: 'S', label: 'Structured', note: 'native JSON schema' },
  TEXT: { letter: 'T', label: 'Text', note: 'prose-parsed fallback' },
  NORMALIZED: { letter: 'N', label: 'Normalized', note: '2nd-LLM recovered' },
  FALLBACK: { letter: 'F', label: 'Fallback', note: 'random legal move — unreliable' },
  ACCESS: { letter: 'A', label: 'Access', note: 'provider blocked on this team' },
  TIMEOUT: { letter: '·', label: 'Timeout', note: 'exceeded the deadline (may be flaky)' },
  ERROR: { letter: '×', label: 'Error', note: 'request failed' },
};
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

type AvailKind = 'public' | 'partial' | 'exclusive' | 'none' | 'na';
// A short, human name for a team in the availability column (drop the obvious prefixes).
const shortTeam = (name: string): string => name.replace(/^(Vercel|AI Gateway)\s+/i, '').replace(/\s+Models$/i, '');
function availKind(id: string, reports: Report[], g: GameKind): { label: string; kind: AvailKind } {
  const rele = reports.filter((r) => r.games.includes(g));
  if (!rele.length) return { label: 'n/a', kind: 'na' };
  const on = rele.filter((r) => PLAYABLE.has(r.models.find((m) => m.id === id)?.[g]?.status ?? ('' as Status)));
  if (!on.length) return { label: 'none', kind: 'none' };
  if (on.length === rele.length) return { label: 'public', kind: 'public' };
  if (on.length === 1) return { label: `only ${shortTeam(on[0].team.name)}`, kind: 'exclusive' };
  // Partial: name the teams it DOES play on rather than an opaque "2/3".
  return { label: on.map((r) => shortTeam(r.team.name)).join(', '), kind: 'partial' };
}

function cellHtml(r?: GameResult): string {
  if (!r) return '<td class="cell empty">·</td>';
  const m = STATUS_META[r.status];
  const tip = `${r.status}${r.move ? ` → ${r.move}` : ''} · ${(r.ms / 1000).toFixed(1)}s${r.detail ? ` · ${r.detail}` : ` · ${m.note}`}`;
  const extra = r.move ? `<span class="mv">${esc(r.move)}</span>` : '';
  return `<td class="cell st-${r.status}" title="${esc(tip)}"><span class="dot"></span><span class="lt">${m.label}</span>${extra}</td>`;
}

function toHtml(reports: Report[]): string {
  const globalGames = GAME ? [GAME] : (['chess', 'poker'] as GameKind[]).filter((g) => reports.some((r) => r.games.includes(g)));
  const primary = globalGames[0]; // for the cross-team availability column
  // Default the picker to the private-beta team if present, else the first report.
  const activeSlug = reports.find((r) => r.team.slug === 'vercel-internal-playground')?.team.slug ?? reports[0].team.slug;
  const ordered = [...SEVERITY].reverse(); // best (STRUCTURED) → worst, for legends/breakdowns

  // Summary tiles: team name once, per-game playable count + bar + a compact status breakdown.
  const tiles = reports
    .map((r) => {
      const gs = games(r);
      const cells = gs
        .map((g) => {
          const play = r.models.filter((m) => PLAYABLE.has(m[g]?.status ?? ('' as Status))).length;
          const pct = Math.round((100 * play) / r.models.length);
          const brk = ordered
            .map((s) => ({ s, n: r.models.filter((m) => m[g]?.status === s).length }))
            .filter((x) => x.n)
            .map((x) => `<span class="chip st-${x.s}" title="${x.s} — ${STATUS_META[x.s].note}"><span class="dot"></span>${STATUS_META[x.s].letter} ${x.n}</span>`)
            .join('');
          return `<div class="g"><div class="g-top"><span class="g-k">${g}</span><span class="g-v">${play}<span class="g-d">/${r.models.length}</span></span></div><div class="bar"><span style="width:${pct}%"></span></div><div class="brk">${brk}</div></div>`;
        })
        .join('');
      const active = r.team.slug === activeSlug ? ' active' : '';
      return `<button class="tile${active}" data-tile="${esc(r.team.slug)}"><div class="tile-h">${esc(r.team.name)}</div><div class="games">${cells}</div><div class="tile-d">${r.generatedAt.slice(0, 10)} · norm ${esc(String(r.normalizer ?? 'off'))}</div></button>`;
    })
    .join('');

  const legend = ordered
    .map((s) => `<div class="lg"><span class="dot st-${s}"></span><span class="lg-t"><span class="lg-l">${STATUS_META[s].letter} ${STATUS_META[s].label}</span> <span class="lg-n">${STATUS_META[s].note}</span></span></div>`)
    .join('');

  // One table per team; only the active one is shown (toggled by the picker / tiles).
  const teamTables = reports
    .map((r) => {
      const gs = games(r);
      const worstOf = (m: Row): Status => SEVERITY.find((s) => gs.some((g) => m[g]?.status === s)) ?? 'STRUCTURED';
      const rows = r.models
        .filter((m) => keepRow(m, gs))
        .sort((a, b) => SEVERITY.indexOf(worstOf(b)) - SEVERITY.indexOf(worstOf(a)) || a.id.localeCompare(b.id))
        .map((m) => {
          const struct = m.chess?.structured ?? m.poker?.structured ?? '—';
          const structCls = struct === 'yes' ? 'yes' : struct === 'no' ? 'no' : 'na';
          const av = availKind(m.id, reports, primary);
          const play = gs.some((g) => PLAYABLE.has(m[g]?.status ?? ('' as Status)));
          const note = gs.map((g) => m[g]).find((gr) => gr && !PLAYABLE.has(gr.status))?.detail ?? '';
          const gameCells = gs.map((g) => cellHtml(m[g])).join('');
          return `<tr data-id="${esc(m.id.toLowerCase())}" data-play="${play ? 1 : 0}" data-avail="${av.kind}"><td class="c-model" title="${esc(m.id)}">${esc(m.id)}</td><td class="c-struct struct-${structCls}">${struct}</td>${gameCells}<td><span class="av av-${av.kind}">${esc(av.label)}</span></td><td class="c-notes" title="${esc(note)}">${esc(note)}</td></tr>`;
        })
        .join('\n');
      const head = `<th class="c-model">Model</th><th>Struct</th>${gs.map((g) => `<th>${g}</th>`).join('')}<th>Availability</th><th class="c-notes">Notes</th>`;
      const hidden = r.team.slug === activeSlug ? '' : ' hidden';
      return `<div class="teamtable${hidden}" data-team="${esc(r.team.slug)}"><div class="scroll"><table><thead><tr>${head}</tr></thead><tbody>\n${rows}\n</tbody></table></div></div>`;
    })
    .join('\n');

  const teamBtns = reports.map((r) => `<button data-t="${esc(r.team.slug)}"${r.team.slug === activeSlug ? ' class="on"' : ''}>${esc(r.team.name)}</button>`).join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Arcade model compatibility</title>
<style>
:root{color-scheme:light;
 --bg:#f9f9f7;--surface:#fcfcfb;--ink:#0b0b0b;--ink2:#52514e;--muted:#898781;--border:rgba(11,11,11,.12);--grid:#ecebe6;
 --st-STRUCTURED:#0ca30c;--st-TEXT:#1baf7a;--st-NORMALIZED:#2a78d6;--st-ACCESS:#898781;--st-TIMEOUT:#fab219;--st-FALLBACK:#ec835a;--st-ERROR:#d03b3b;
 --av-public:#0ca30c;--av-partial:#fab219;--av-exclusive:#4a3aa7;--av-none:#d03b3b;}
:root[data-theme="dark"]{color-scheme:dark;
 --bg:#0d0d0d;--surface:#1a1a19;--ink:#fff;--ink2:#c3c2b7;--muted:#898781;--border:rgba(255,255,255,.14);--grid:#2c2c2a;
 --st-TEXT:#199e70;--st-NORMALIZED:#3987e5;--av-exclusive:#9085e9;}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:26px 20px 90px}
h1{font-size:22px;margin:0 0 2px}.sub{color:var(--ink2);margin:0 0 20px;max-width:70ch}
.dot{width:9px;height:9px;border-radius:50%;background:var(--c,var(--muted));flex:none;display:inline-block}
.st-STRUCTURED{--c:var(--st-STRUCTURED)}.st-TEXT{--c:var(--st-TEXT)}.st-NORMALIZED{--c:var(--st-NORMALIZED)}
.st-ACCESS{--c:var(--st-ACCESS)}.st-TIMEOUT{--c:var(--st-TIMEOUT)}.st-FALLBACK{--c:var(--st-FALLBACK)}.st-ERROR{--c:var(--st-ERROR)}
/* tiles double as the team picker */
.tiles{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:18px}
.tile{flex:1;min-width:250px;text-align:left;font:inherit;color:inherit;cursor:pointer;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:14px 16px}
.tile.active{border-color:var(--st-NORMALIZED);box-shadow:0 0 0 1px var(--st-NORMALIZED)}
.tile-h{font-weight:650;font-size:15px}
.games{display:flex;gap:22px;margin:12px 0 2px}.g{flex:1}
.g-top{display:flex;justify-content:space-between;align-items:baseline}
.g-k{color:var(--ink2);font-size:12px;text-transform:capitalize}.g-v{font-size:22px;font-weight:650}.g-d{color:var(--muted);font-size:13px;font-weight:400}
.bar{height:5px;border-radius:3px;background:var(--grid);margin:5px 0 7px;overflow:hidden}.bar span{display:block;height:100%;background:var(--st-STRUCTURED)}
.brk{display:flex;flex-wrap:wrap;gap:4px 6px}
.chip{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-variant-numeric:tabular-nums;color:var(--ink2);background:color-mix(in srgb,var(--c) 14%,var(--surface));border-radius:6px;padding:1px 6px}
.chip .dot{width:7px;height:7px}
.tile-d{color:var(--muted);font-size:11px;margin-top:10px}
/* legend */
.legend{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px 28px;margin-bottom:4px;padding:16px;background:var(--surface);border:1px solid var(--border);border-radius:12px}
.lg{display:grid;grid-template-columns:12px 1fr;gap:9px;align-items:start;line-height:1.4;font-size:13px}
.lg .dot{margin-top:5px}.lg-l{font-weight:600}.lg-n{color:var(--muted);font-size:12px}
/* controls */
.controls{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:14px;position:sticky;top:0;background:var(--bg);padding:10px 0;z-index:20}
#team{margin-right:auto}
input#q{background:var(--surface);border:1px solid var(--border);color:var(--ink);border-radius:8px;padding:7px 11px;font:inherit;min-width:200px}
.seg{display:flex;border:1px solid var(--border);border-radius:8px;overflow:hidden}
.seg button{background:var(--surface);color:var(--ink2);border:0;padding:7px 12px;font:inherit;cursor:pointer;border-left:1px solid var(--border)}
.seg button:first-child{border-left:0}.seg button.on{background:var(--st-NORMALIZED);color:#fff}
.btn{background:var(--surface);border:1px solid var(--border);color:var(--ink2);border-radius:8px;padding:7px 12px;font:inherit;cursor:pointer}
.count{color:var(--muted);font-variant-numeric:tabular-nums}
/* table — scroll box freezes the header (top) and the model column (left) */
.scroll{overflow:auto;max-height:74vh;border:1px solid var(--border);border-radius:12px;background:var(--surface)}
.teamtable table{border-collapse:separate;border-spacing:0;width:100%}
th,td{text-align:left;padding:7px 12px;border-bottom:1px solid var(--grid);white-space:nowrap}
tbody tr:last-child td{border-bottom:0}
thead th{position:sticky;top:0;background:var(--surface);color:var(--ink2);font-weight:600;font-size:12px;text-transform:capitalize;z-index:5}
td.c-model{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;position:sticky;left:0;background:var(--surface);z-index:2}
thead .c-model{left:0;z-index:6}
tbody tr:hover td{background:color-mix(in srgb,var(--st-NORMALIZED) 9%,var(--surface))}
.c-struct{font-size:12px}.struct-yes{color:var(--st-STRUCTURED);font-weight:600}.struct-no{color:var(--muted)}.struct-na{color:var(--muted)}
details{margin-bottom:14px}.lg-sum{cursor:pointer;color:var(--ink2);font-size:13px;padding:4px 0}
.cell{background:color-mix(in srgb,var(--c) 15%,var(--surface))}
.cell .dot{vertical-align:middle;margin-right:5px}.cell .lt{font-weight:700;color:var(--ink)}
.cell .mv{color:var(--ink2);font-size:11px;margin-left:6px;font-variant-numeric:tabular-nums}
.cell.empty{background:transparent;color:var(--muted)}
.av{padding:2px 9px;border-radius:999px;font-size:11px;font-weight:600;color:#fff;background:var(--ac,var(--muted))}
.av-public{--ac:var(--av-public)}.av-partial{--ac:var(--av-partial);color:#3a2c00}.av-exclusive{--ac:var(--av-exclusive)}.av-none{--ac:var(--av-none)}.av-na{--ac:var(--muted)}
.c-notes{color:var(--muted);font-size:12px;max-width:340px;overflow:hidden;text-overflow:ellipsis}
.hidden{display:none}
</style></head><body>
<div class="wrap">
<h1>Arcade model compatibility</h1>
<p class="sub">Pick a Vercel team below to see its table. Each cell is the highest fallback rung that produced a legal, attributable move; hover for the move, latency, and reason.</p>
<div class="tiles">${tiles}</div>
<details><summary class="lg-sum">status legend</summary><div class="legend">${legend}</div></details>
<div class="controls">
 <div class="seg" id="team">${teamBtns}</div>
 <input id="q" placeholder="filter models…" autocomplete="off">
 <div class="seg" id="mode"><button data-m="all" class="on">All</button><button data-m="play">Playable</button><button data-m="fail">Failing</button></div>
 <div class="seg" id="avail"><button data-a="public">public</button><button data-a="partial">partial</button><button data-a="exclusive">exclusive</button><button data-a="none">none</button></div>
 <button class="btn" id="theme">◐ theme</button>
 <span class="count" id="count"></span>
</div>
${teamTables}
</div>
<script>
const q=document.getElementById('q'),count=document.getElementById('count'),tables={};
document.querySelectorAll('.teamtable').forEach(t=>tables[t.dataset.team]=t);
let active=${JSON.stringify(activeSlug)},mode='all',avail=new Set();
const rows=()=>[...tables[active].querySelectorAll('tbody tr')];
function apply(){const term=q.value.trim().toLowerCase();let n=0;
 for(const r of rows()){const okQ=!term||r.dataset.id.includes(term);
  const okM=mode==='all'||(mode==='play'&&r.dataset.play==='1')||(mode==='fail'&&r.dataset.play==='0');
  const okA=avail.size===0||avail.has(r.dataset.avail);
  const show=okQ&&okM&&okA;r.classList.toggle('hidden',!show);if(show)n++;}
 count.textContent=n+' of '+rows().length;}
function setTeam(slug){active=slug;
 for(const s in tables)tables[s].classList.toggle('hidden',s!==slug);
 document.querySelectorAll('#team button').forEach(b=>b.classList.toggle('on',b.dataset.t===slug));
 document.querySelectorAll('.tile').forEach(t=>t.classList.toggle('active',t.dataset.tile===slug));
 apply();}
q.oninput=apply;
document.querySelectorAll('#team button').forEach(b=>b.onclick=()=>setTeam(b.dataset.t));
document.querySelectorAll('.tile').forEach(t=>t.onclick=()=>setTeam(t.dataset.tile));
document.querySelectorAll('#mode button').forEach(b=>b.onclick=()=>{mode=b.dataset.m;document.querySelectorAll('#mode button').forEach(x=>x.classList.toggle('on',x===b));apply();});
document.querySelectorAll('#avail button').forEach(b=>b.onclick=()=>{const a=b.dataset.a;if(avail.has(a)){avail.delete(a);b.classList.remove('on');}else{avail.add(a);b.classList.add('on');}apply();});
const root=document.documentElement,mq=matchMedia('(prefers-color-scheme:dark)');root.dataset.theme=mq.matches?'dark':'light';
document.getElementById('theme').onclick=()=>root.dataset.theme=root.dataset.theme==='dark'?'light':'dark';
apply();
</script>
</body></html>`;
}

function main(): void {
  const reports = loadReports();
  if (!reports.length) {
    console.error(`No reports found in ${DIR}/model-compat.*.json. Generate one with:\n  pnpm models:audit sweep            # quick (one model per creator)\n  pnpm models:audit all --team=<slug>`);
    process.exit(1);
  }

  let lines: string[];
  if (TEAM) {
    const r = reports.find((x) => x.team.slug === TEAM);
    if (!r) {
      console.error(`No report for team "${TEAM}". Available: ${reports.map((x) => x.team.slug).join(', ')}`);
      process.exit(1);
    }
    lines = renderSingle(r);
  } else if (reports.length === 1 && !FORCE_MATRIX) {
    lines = renderSingle(reports[0]);
  } else {
    lines = renderMatrix(reports);
  }

  console.log(lines.join('\n'));

  const md = arg('md');
  if (md !== undefined) {
    const path = md || 'docs/model-compat.md';
    writeFileSync(path, `${toMarkdown(reports)}\n`);
    console.log(dim(`\nwrote combined markdown → ${path}`));
  }

  const html = arg('html');
  if (html !== undefined) {
    const path = html || 'docs/model-compat.html';
    writeFileSync(path, toHtml(reports));
    console.log(dim(`\nwrote HTML report → ${path}  (open in a browser)`));
  }
}

main();
