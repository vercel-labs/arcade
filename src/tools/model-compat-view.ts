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
//   pnpm models:report --md[=docs/model-compat.md]   # also write a combined markdown ref
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

  // Summary counts per game.
  for (const g of gs) {
    const counts = SEVERITY.map((s) => ({ s, n: r.models.filter((m) => m[g]?.status === s).length })).filter((c) => c.n);
    const playable = r.models.filter((m) => PLAYABLE.has(m[g]?.status ?? ('' as Status))).length;
    out.push(`  ${bold(g.padEnd(6))} ${green(`${playable}/${r.models.length} playable`)}   ${counts.map((c) => `${STYLE[c.s].color(c.s)} ${c.n}`).join('  ')}`);
  }
  out.push('');
  out.push(dim('  legend: STRUCTURED=native JSON · TEXT=prose-parsed · NORMALIZED=2nd-LLM · FALLBACK=random · ACCESS=team blocked · TIMEOUT/ERROR'));
  out.push('');

  const rows = r.models.filter((m) => keepRow(m, gs)).sort((a, b) => SEVERITY.indexOf(worst(a, gs) ?? 'STRUCTURED') - SEVERITY.indexOf(worst(b, gs) ?? 'STRUCTURED') || a.id.localeCompare(b.id));
  const idW = Math.max(5, ...rows.map((m) => m.id.length));
  const header = `  ${pad(bold('MODEL'), idW)}  ${pad(bold('STRUCT'), 6)}  ${gs.map((g) => pad(bold(g.toUpperCase()), 12)).join('  ')}  ${bold('NOTES')}`;
  out.push(header);
  for (const m of rows) {
    const struct = m.chess?.structured ?? m.poker?.structured ?? '—';
    const structCell = struct === 'yes' ? green('yes') : struct === 'no' ? yellow('no ') : dim('—  ');
    const cells = gs.map((g) => pad(`${statusLabel(m[g]?.status)}${m[g]?.move ? ' ' + dim(m[g]!.move) : ''}`, 12)).join('  ');
    const note = gs.map((g) => m[g]?.detail).find(Boolean) ?? '';
    out.push(`  ${pad(m.id, idW)}  ${pad(structCell, 6)}  ${cells}  ${dim(note.slice(0, 80))}`);
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
}

main();
