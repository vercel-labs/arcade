import { DEFAULT_BIG_BLIND, DEFAULT_HANDS_PER_LEVEL, DEFAULT_SMALL_BLIND } from '../../rules/poker/blinds.ts';
import { STARTING_STACK } from '../../harness/games/poker/poker-session.ts';
import { deriveSeed } from './random.ts';
import type { MatchLabEvent, MatchLabGame, MatchLabPlan, MatchLabResult } from './types.ts';

export type ModelGameAuditStatus =
  | 'STRUCTURED'
  | 'TEXT'
  | 'NORMALIZED'
  | 'FALLBACK'
  | 'ACCESS'
  | 'TIMEOUT'
  | 'ERROR'
  | 'NO_ACTION';

export const MODEL_GAME_AUDIT_QUALITY: Record<ModelGameAuditStatus, number> = {
  STRUCTURED: 7,
  TEXT: 6,
  NORMALIZED: 5,
  FALLBACK: 4,
  NO_ACTION: 3,
  ERROR: 2,
  TIMEOUT: 1,
  ACCESS: 0,
};

export interface ModelGameAuditCase {
  id: string;
  targetModel: string;
  opponentModel: string;
  game: MatchLabGame;
  plan: MatchLabPlan;
  retry: number;
}

// How the target model actually behaved across its decisions in one scenario: the latency
// distribution of whole decisions (every rung of the fallback ladder included), how often a
// first answer had to be retried, which rung finally produced each move, the provider errors
// seen, and the tokens spent. This is what the speed benchmark ranks on.
export interface ModelGameAuditStats {
  decisions: number;
  retries: number;
  latencyMs: { p50: number; p90: number; max: number };
  resolutions: Record<string, number>;
  errors: string[];
  tokens: { input: number; output: number };
}

export interface ModelGameAuditRow {
  id: string;
  targetModel: string;
  opponentModel: string;
  game: MatchLabGame;
  retry: number;
  status: ModelGameAuditStatus;
  playable: boolean;
  targetActions: number;
  durationMs: number;
  matchStatus: MatchLabResult['status'];
  stopReason: string;
  matchId: string;
  stats: ModelGameAuditStats;
}

// `audit` asks the smallest question, "can this model produce one legal move per game";
// `bench` plays long enough to time it: five of the target's chess moves, two poker hands,
// and an Islanders setup plus two rounds of turns.
export type ModelMatrixDepth = 'audit' | 'bench';

export interface BuildModelMatrixOpts {
  games: readonly MatchLabGame[];
  models: readonly string[];
  opponentModel: string;
  seed: number;
  timeoutMs: number;
  retry?: number;
  depth?: ModelMatrixDepth;
}

export const MODEL_MATRIX_SCENARIOS: Record<ModelMatrixDepth, { chess: { maxPlies: number }; poker: { maxHands: number }; islanders: { setupOnly: boolean; maxActions: number } }> = {
  audit: { chess: { maxPlies: 2 }, poker: { maxHands: 1 }, islanders: { setupOnly: true, maxActions: 2 } },
  bench: { chess: { maxPlies: 10 }, poker: { maxHands: 2 }, islanders: { setupOnly: false, maxActions: 22 } },
};

function limits(game: MatchLabGame, timeoutMs: number, depth: ModelMatrixDepth): MatchLabPlan['limits'] {
  const scenario = MODEL_MATRIX_SCENARIOS[depth];
  return {
    timeoutMs,
    maxPlies: game === 'chess' ? scenario.chess.maxPlies : 300,
    maxHands: game === 'poker' ? scenario.poker.maxHands : 100,
    maxActions: game === 'poker' ? 40 * scenario.poker.maxHands : game === 'islanders' ? scenario.islanders.maxActions : 20,
  };
}

export function buildModelMatrixCases(opts: BuildModelMatrixOpts): ModelGameAuditCase[] {
  const retry = opts.retry ?? 0;
  const depth = opts.depth ?? 'audit';
  const cases: ModelGameAuditCase[] = [];
  let index = 0;
  for (const game of opts.games) {
    for (const targetModel of opts.models) {
      const baseId = `${game}-${String(index + 1).padStart(4, '0')}`;
      const id = retry > 0 ? `${baseId}-retry${retry}` : baseId;
      cases.push({
        id,
        targetModel,
        opponentModel: opts.opponentModel,
        game,
        retry,
        plan: {
          id,
          index,
          game,
          models: [targetModel, opts.opponentModel],
          seed: deriveSeed(opts.seed, index + retry * Math.max(1, opts.models.length * opts.games.length)),
          limits: limits(game, opts.timeoutMs, depth),
          startingChips: STARTING_STACK,
          smallBlind: DEFAULT_SMALL_BLIND,
          bigBlind: DEFAULT_BIG_BLIND,
          handsPerLevel: DEFAULT_HANDS_PER_LEVEL,
          setupOnly: game === 'islanders' && MODEL_MATRIX_SCENARIOS[depth].islanders.setupOnly,
          communicationMode: 'autoreply',
          harness: 'current',
          captureThinking: false,
        },
      });
      index++;
    }
  }
  return cases;
}

export function retryModelMatrixCase(auditCase: ModelGameAuditCase, retry: number): ModelGameAuditCase {
  const id = `${auditCase.id.replace(/-retry\d+$/, '')}-retry${retry}`;
  return {
    ...auditCase,
    id,
    retry,
    plan: {
      ...auditCase.plan,
      id,
      seed: deriveSeed(auditCase.plan.seed, retry),
    },
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;
}

function resolution(event: Omit<MatchLabEvent, 'runId' | 'matchId' | 'at'>): string | undefined {
  if (event.type !== 'action_chosen' || event.seat !== 0) return undefined;
  const data = record(event.data);
  const choice = record(data?.choice);
  const diagnostics = record(data?.diagnostics) ?? record(choice?.diagnostics);
  return typeof diagnostics?.resolution === 'string' ? diagnostics.resolution : undefined;
}

function fallbackReason(event: Omit<MatchLabEvent, 'runId' | 'matchId' | 'at'>): string | undefined {
  if (event.type !== 'action_chosen' || event.seat !== 0) return undefined;
  const data = record(event.data);
  const choice = record(data?.choice);
  const diagnostics = record(data?.diagnostics) ?? record(choice?.diagnostics);
  return typeof diagnostics?.fallbackReason === 'string' ? diagnostics.fallbackReason : undefined;
}

function targetDiagnostics(event: Omit<MatchLabEvent, 'runId' | 'matchId' | 'at'>): Record<string, unknown> | undefined {
  if (event.type !== 'action_chosen' || event.seat !== 0) return undefined;
  const data = record(event.data);
  const choice = record(data?.choice);
  return record(data?.diagnostics) ?? record(choice?.diagnostics);
}

// Nearest-rank percentile: the smallest sample at or above the q-th share of the set.
function percentile(sorted: readonly number[], q: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
}

export function modelGameAuditStats(events: ReadonlyArray<Omit<MatchLabEvent, 'runId' | 'matchId' | 'at'>>): ModelGameAuditStats {
  const latencies: number[] = [];
  const resolutions: Record<string, number> = {};
  const tokens = { input: 0, output: 0 };
  let decisions = 0;
  let retries = 0;
  for (const event of events) {
    const diagnostics = targetDiagnostics(event);
    if (!diagnostics) continue;
    decisions++;
    if (typeof diagnostics.durationMs === 'number') latencies.push(diagnostics.durationMs);
    const resolution = typeof diagnostics.resolution === 'string' ? diagnostics.resolution : 'unknown';
    resolutions[resolution] = (resolutions[resolution] ?? 0) + 1;
    const attempts = Array.isArray(diagnostics.attempts) ? diagnostics.attempts : [];
    retries += Math.max(0, attempts.length - 1);
    for (const attempt of attempts) {
      const a = record(attempt);
      if (typeof a?.inputTokens === 'number') tokens.input += a.inputTokens;
      if (typeof a?.outputTokens === 'number') tokens.output += a.outputTokens;
    }
  }
  const errors: string[] = [];
  for (const event of events) {
    if (event.type !== 'model_attempt' || event.seat !== 0) continue;
    const data = record(event.data);
    if (data?.result !== 'error' || typeof data.raw !== 'string') continue;
    const text = data.raw.replace(/\s+/g, ' ').slice(0, 100);
    if (!errors.includes(text) && errors.length < 3) errors.push(text);
  }
  const sorted = [...latencies].sort((a, b) => a - b);
  return {
    decisions,
    retries,
    latencyMs: { p50: percentile(sorted, 0.5), p90: percentile(sorted, 0.9), max: sorted.at(-1) ?? 0 },
    resolutions,
    errors,
    tokens,
  };
}

export function classifyModelGameAudit(
  auditCase: ModelGameAuditCase,
  result: MatchLabResult,
  events: ReadonlyArray<Omit<MatchLabEvent, 'runId' | 'matchId' | 'at'>>,
): ModelGameAuditRow {
  const targetActions = events.filter((event) => event.type === 'action_chosen' && event.seat === 0).length;
  const resolutions = events.map(resolution).filter((value): value is string => value !== undefined);
  let status: ModelGameAuditStatus;
  if (resolutions.includes('structured')) status = 'STRUCTURED';
  else if (resolutions.includes('text')) status = 'TEXT';
  else if (resolutions.includes('normalized')) status = 'NORMALIZED';
  else if (resolutions.includes('random-fallback')) {
    status = events.some((event) => fallbackReason(event) === 'unavailable') ? 'ACCESS' : 'FALLBACK';
  } else if (result.status === 'failed' && result.error?.name === 'NotifiedModelFailure') status = 'ACCESS';
  else if (result.status === 'failed') status = 'ERROR';
  else if (result.stopReason === 'timeout') status = 'TIMEOUT';
  else status = 'NO_ACTION';
  return {
    id: auditCase.id,
    targetModel: auditCase.targetModel,
    opponentModel: auditCase.opponentModel,
    game: auditCase.game,
    retry: auditCase.retry,
    status,
    playable: status === 'STRUCTURED' || status === 'TEXT' || status === 'NORMALIZED',
    targetActions,
    durationMs: result.durationMs,
    matchStatus: result.status,
    stopReason: result.stopReason,
    matchId: result.id,
    stats: modelGameAuditStats(events),
  };
}

export function betterModelGameAudit(a: ModelGameAuditRow, b: ModelGameAuditRow): ModelGameAuditRow {
  return MODEL_GAME_AUDIT_QUALITY[b.status] > MODEL_GAME_AUDIT_QUALITY[a.status] ? b : a;
}

export function shouldRetryModelGameAudit(row: ModelGameAuditRow): boolean {
  return ['FALLBACK', 'TIMEOUT', 'ERROR', 'NO_ACTION'].includes(row.status);
}

export function modelGameAuditMarkdown(rows: readonly ModelGameAuditRow[], meta: {
  generatedAt: string;
  teamName: string;
  teamSlug: string;
  catalogSource: string;
}): string {
  const statuses = Object.keys(MODEL_GAME_AUDIT_QUALITY) as ModelGameAuditStatus[];
  const lines = [
    '# Arcade model game audit',
    '',
    `_Generated ${meta.generatedAt} · team **${meta.teamName}** (${meta.teamSlug}) · catalog ${meta.catalogSource}_`,
    '',
    `Playable scenarios: **${rows.filter((row) => row.playable).length} / ${rows.length}**`,
    '',
    ...statuses.map((status) => `- ${status}: ${rows.filter((row) => row.status === status).length}`),
    '',
    '| model | game | status | target actions | ms | stop reason |',
    '| --- | --- | --- | ---: | ---: | --- |',
    ...[...rows]
      .sort((a, b) => a.targetModel.localeCompare(b.targetModel) || a.game.localeCompare(b.game))
      .map((row) => `| \`${row.targetModel}\` | ${row.game} | ${row.status} | ${row.targetActions} | ${row.durationMs} | ${row.stopReason.replace(/\|/g, '\\|')} |`),
    '',
  ];
  return lines.join('\n');
}

// One line per model across its games, for the benchmark artifact. `verdict` is coarse on
// purpose: `broken` when any game was not playable, otherwise the slowest game's median
// decision decides between fast (< 5 s), ok (< 20 s), and slow.
export interface ModelBenchEntry {
  model: string;
  verdict: 'fast' | 'ok' | 'slow' | 'broken';
  games: Partial<Record<MatchLabGame, { status: ModelGameAuditStatus; p50Ms: number; p90Ms: number; decisions: number; retries: number; errors: string[] }>>;
  pricePerMillion?: { input: number; output: number };
  free?: boolean;
}

export function modelBenchEntries(rows: readonly ModelGameAuditRow[], pricing: ReadonlyMap<string, { input: number; output: number }> = new Map()): ModelBenchEntry[] {
  const byModel = new Map<string, ModelGameAuditRow[]>();
  for (const row of rows) (byModel.get(row.targetModel) ?? byModel.set(row.targetModel, []).get(row.targetModel)!).push(row);
  return [...byModel.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([model, list]) => {
    const games: ModelBenchEntry['games'] = {};
    let slowest = 0;
    let broken = false;
    for (const row of list) {
      games[row.game] = { status: row.status, p50Ms: row.stats.latencyMs.p50, p90Ms: row.stats.latencyMs.p90, decisions: row.stats.decisions, retries: row.stats.retries, errors: row.stats.errors };
      if (!row.playable) broken = true;
      slowest = Math.max(slowest, row.stats.latencyMs.p50);
    }
    const verdict: ModelBenchEntry['verdict'] = broken ? 'broken' : slowest < 5_000 ? 'fast' : slowest < 20_000 ? 'ok' : 'slow';
    const price = pricing.get(model);
    return { model, verdict, games, ...(price ? { pricePerMillion: price, free: price.input === 0 && price.output === 0 } : {}) };
  });
}

export function modelBenchMarkdown(entries: readonly ModelBenchEntry[], games: readonly MatchLabGame[], meta: { generatedAt: string; teamName: string; teamSlug: string }): string {
  const seconds = (ms: number | undefined): string => (ms === undefined ? '' : (ms / 1000).toFixed(1));
  const order: Record<ModelBenchEntry['verdict'], number> = { fast: 0, ok: 1, slow: 2, broken: 3 };
  const sorted = [...entries].sort((a, b) => order[a.verdict] - order[b.verdict] || Math.max(...games.map((g) => a.games[g]?.p50Ms ?? 0)) - Math.max(...games.map((g) => b.games[g]?.p50Ms ?? 0)));
  const header = ['model', 'verdict', ...games.map((g) => `${g} p50 s`), ...games.map((g) => `${g} p90 s`), 'retries', '$/M in', '$/M out', 'errors'];
  const lines = [
    '# Arcade model speed benchmark',
    '',
    `_Generated ${meta.generatedAt} · team **${meta.teamName}** (${meta.teamSlug}) · each model as seat 0 against one fixed opponent: ${MODEL_MATRIX_SCENARIOS.bench.chess.maxPlies / 2} chess moves, ${MODEL_MATRIX_SCENARIOS.bench.poker.maxHands} poker hands, Islanders setup + turns to ${MODEL_MATRIX_SCENARIOS.bench.islanders.maxActions} actions. Latency is the whole decision, every fallback rung included._`,
    '',
    ...(['fast', 'ok', 'slow', 'broken'] as const).map((v) => `- ${v}: ${entries.filter((e) => e.verdict === v).length}`),
    '',
    `| ${header.join(' | ')} |`,
    `| ${header.map((h, i) => (i < 2 || i === header.length - 1 ? '---' : '---:')).join(' | ')} |`,
    ...sorted.map((e) => {
      const retries = games.reduce((sum, g) => sum + (e.games[g]?.retries ?? 0), 0);
      const errors = games.flatMap((g) => e.games[g]?.errors ?? []).slice(0, 1).join('; ').replace(/\|/g, '\\|');
      const price = e.pricePerMillion;
      return `| \`${e.model}\`${e.free ? ' (free)' : ''} | ${e.verdict} | ${games.map((g) => seconds(e.games[g]?.p50Ms)).join(' | ')} | ${games.map((g) => seconds(e.games[g]?.p90Ms)).join(' | ')} | ${retries} | ${price ? price.input.toFixed(2) : ''} | ${price ? price.output.toFixed(2) : ''} | ${errors} |`;
    }),
    '',
  ];
  return lines.join('\n');
}
