// Live, team-aware compatibility matrix built on the real match-lab adapters.
// Each selected model is seat 0 against one stable opponent in bounded Chess,
// Poker, and Islanders scenarios. Telemetry is always disabled; traces stay local.
//
// `--bench` plays each scenario long enough to time the model (five chess moves, two
// poker hands, an Islanders setup plus two rounds) and records per-decision latency,
// retries, the fallback rung, provider errors, tokens, and the model's list price, so
// the report ranks models by speed as well as playability. `--publish=DIR` also writes
// the per-model summary as `model-bench.<team>.json` and `.md` for the repo to keep.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { ensureCachedGatewayKey } from '../auth/index.ts';
import { fetchTeamModelCatalog } from '../arcade/match/team-model-catalog.ts';
import { MatchLabArtifacts, runWorkerPool } from './match-lab/artifacts.ts';
import { runIslandersMatchLab } from './match-lab/adapters/islanders.ts';
import { runChessMatch } from './match-lab/adapters/chess.ts';
import { runPokerMatchLab } from './match-lab/adapters/poker.ts';
import {
  betterModelGameAudit,
  buildModelMatrixCases,
  classifyModelGameAudit,
  MODEL_MATRIX_SCENARIOS,
  modelBenchEntries,
  modelBenchMarkdown,
  modelGameAuditMarkdown,
  retryModelMatrixCase,
  shouldRetryModelGameAudit,
  type ModelGameAuditCase,
  type ModelGameAuditRow,
  type ModelMatrixDepth,
} from './match-lab/model-matrix.ts';
import type { MatchLabAdapter, MatchLabEvent, MatchLabGame, MatchLabResult } from './match-lab/types.ts';

process.env.ARCADE_TELEMETRY = '0';

const ADAPTERS: Record<MatchLabGame, MatchLabAdapter> = {
  chess: runChessMatch,
  poker: runPokerMatchLab,
  islanders: runIslandersMatchLab,
};
const DEFAULT_OPPONENT = 'anthropic/claude-haiku-4.5';
const DEFAULT_SEED = 0xa11ce;

function value(args: readonly string[], name: string): string | undefined {
  const exact = args.indexOf(`--${name}`);
  if (exact >= 0 && args[exact + 1] && !args[exact + 1].startsWith('--')) return args[exact + 1];
  return args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function positiveInt(args: readonly string[], name: string, fallback: number): number {
  const raw = value(args, name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new RangeError(`--${name} must be a positive integer`);
  return parsed;
}

function nonnegativeInt(args: readonly string[], name: string, fallback: number): number {
  const raw = value(args, name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) throw new RangeError(`--${name} must be a non-negative integer`);
  return parsed;
}

function games(args: readonly string[]): MatchLabGame[] {
  const selected = (value(args, 'games') ?? 'chess,poker,islanders').split(',').map((game) => game.trim()).filter(Boolean);
  if (selected.some((game) => !['chess', 'poker', 'islanders'].includes(game))) throw new Error('--games accepts chess,poker,islanders');
  return [...new Set(selected)] as MatchLabGame[];
}

function usage(): void {
  console.log(`Usage: pnpm models:game-audit -- [options]

Runs every selected team-visible text model through real bounded match-lab scenarios:
  chess  target plays White for two plies
  poker  target plays seat 1 for one heads-up hand
  islanders  target performs its first settlement + road during initial setup

Options:
  --games=LIST             chess,poker,islanders (default all three)
  --models=LIST            explicit comma-separated model IDs (default live team catalog)
  --creator=SLUG           only one creator from the live team catalog
  --opponent=MODEL         stable opponent (default ${DEFAULT_OPPONENT})
  --concurrency=N          parallel scenarios (default 3)
  --timeout=N              seconds per scenario (default 300)
  --retry-attempts=N       serial retries for soft failures (default 2)
  --limit=N                audit only the first N selected models
  --output=PATH            artifact directory (default .runs/<timestamp>-model-game-audit)
  --dry-run                print the matrix without making model calls
  --allow-fallback-catalog use Arcade's baked catalog if team availability cannot load
  --strict                 exit non-zero when any final scenario is not playable
  --bench                  longer scenarios + latency/retry/price stats (speed benchmark)
  --publish=DIR            with --bench: also write model-bench.<team>.json/.md into DIR

Telemetry is always disabled. Prompts, attempts, actions, and results remain on disk.`);
}

function gitCommit(): string | undefined {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return undefined;
  }
}

function failedResult(auditCase: ModelGameAuditCase, startedAt: string, started: number, error: unknown): MatchLabResult {
  const cause = error instanceof Error ? error : new Error(String(error));
  return {
    id: auditCase.id,
    game: auditCase.game,
    status: 'failed',
    models: auditCase.plan.models,
    seed: auditCase.plan.seed,
    startedAt,
    endedAt: new Date().toISOString(),
    durationMs: Math.max(0, Math.round(performance.now() - started)),
    actionCount: 0,
    winnerSeats: [],
    stopReason: cause.name,
    error: { name: cause.name, message: cause.message, ...(cause.stack ? { stack: cause.stack } : {}) },
  };
}

async function fetchListPrices(): Promise<Map<string, { input: number; output: number }>> {
  const prices = new Map<string, { input: number; output: number }>();
  try {
    const response = await fetch('https://ai-gateway.vercel.sh/v1/models', { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return prices;
    const body = (await response.json()) as { data?: Array<{ id?: unknown; pricing?: { input?: unknown; output?: unknown } }> };
    for (const model of body.data ?? []) {
      if (typeof model.id !== 'string') continue;
      const input = Number(model.pricing?.input);
      const output = Number(model.pricing?.output);
      if (Number.isFinite(input) && Number.isFinite(output)) prices.set(model.id, { input: input * 1_000_000, output: output * 1_000_000 });
    }
  } catch {
    // Prices are decoration on the report; a slow public catalog must not stop the run.
  }
  return prices;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    usage();
    return;
  }
  const selectedGames = games(args);
  const depth: ModelMatrixDepth = args.includes('--bench') ? 'bench' : 'audit';
  const publishDir = value(args, 'publish');
  const concurrency = positiveInt(args, 'concurrency', 3);
  const timeoutMs = positiveInt(args, 'timeout', depth === 'bench' ? 900 : 300) * 1_000;
  const retryAttempts = nonnegativeInt(args, 'retry-attempts', depth === 'bench' ? 1 : 2);
  const limit = value(args, 'limit') === undefined ? undefined : positiveInt(args, 'limit', 1);
  const seed = positiveInt(args, 'seed', DEFAULT_SEED);
  const creator = value(args, 'creator');
  const explicitModels = value(args, 'models')?.split(',').map((model) => model.trim()).filter(Boolean);
  const auth = await ensureCachedGatewayKey();
  if (!auth?.team) throw new Error('No cached Arcade login/team. Run `pnpm dev --login` once.');
  const catalog = await fetchTeamModelCatalog(auth.key);
  if (catalog.source === 'fallback' && !args.includes('--allow-fallback-catalog')) {
    throw new Error(`Team-aware model catalog unavailable (${catalog.fallbackReason ?? 'unknown reason'}). Retry or pass --allow-fallback-catalog explicitly.`);
  }
  const catalogModels = catalog.textCreators
    .filter((entry) => !creator || entry.slug === creator)
    .flatMap((entry) => entry.models.map((model) => model.id));
  let modelIds = explicitModels?.length ? explicitModels : catalogModels;
  modelIds = [...new Set(modelIds)].sort();
  if (limit !== undefined) modelIds = modelIds.slice(0, limit);
  if (modelIds.length === 0) throw new Error('No models matched the requested catalog filters.');
  const preferredOpponent = value(args, 'opponent') ?? DEFAULT_OPPONENT;
  const opponentModel = catalogModels.includes(preferredOpponent) || explicitModels?.includes(preferredOpponent)
    ? preferredOpponent
    : catalogModels[0];
  if (!opponentModel) throw new Error('No available opponent model was found.');

  const cases = buildModelMatrixCases({
    games: selectedGames,
    models: modelIds,
    opponentModel,
    seed,
    timeoutMs,
    depth,
  });
  // List prices ride along in the public catalog (USD per token); the benchmark reports
  // them per million so a fast model's cost is visible next to its speed.
  const pricing = depth === 'bench' ? await fetchListPrices() : new Map<string, { input: number; output: number }>();
  console.log(`AI Gateway team: ${auth.team.name} (${auth.team.slug})`);
  console.log(`Catalog: ${catalog.source} · ${modelIds.length} target models`);
  console.log(`Opponent: ${opponentModel}`);
  console.log(`Scenarios: ${cases.length} (${selectedGames.join(', ')})`);
  console.log(`Concurrency: ${Math.min(concurrency, cases.length)} · retries: ${retryAttempts}`);
  console.log('Telemetry: disabled');
  if (args.includes('--dry-run')) {
    for (const game of selectedGames) console.log(`  ${game}: ${modelIds.length}`);
    return;
  }

  const runId = randomUUID();
  const createdAt = new Date().toISOString();
  const stamp = createdAt.replace(/[:.]/g, '-');
  const directory = resolve(value(args, 'output') ?? join('.runs', `${stamp}-model-game-audit`));
  await mkdir(join(directory, 'matches'), { recursive: true });
  const manifest = {
    schemaVersion: 1,
    kind: 'model-game-audit',
    runId,
    createdAt,
    team: { name: auth.team.name, slug: auth.team.slug },
    catalogSource: catalog.source,
    catalogAvailabilityStatus: catalog.availabilityStatus,
    games: selectedGames,
    targetModels: modelIds,
    opponentModel,
    concurrency,
    retryAttempts,
    seed,
    timeoutMs,
    depth,
    scenarios: MODEL_MATRIX_SCENARIOS[depth],
    gitCommit: gitCommit(),
    telemetry: 'disabled',
  };
  await writeFile(join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const artifacts = new MatchLabArtifacts(directory, runId);
  artifacts.emit(undefined, { type: 'run_started', data: manifest });
  console.log(`Artifacts: ${directory}\n`);

  const stop = new AbortController();
  const interrupt = (): void => stop.abort(new Error('interrupted'));
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);

  const runOne = async (auditCase: ModelGameAuditCase): Promise<ModelGameAuditRow> => {
    const captured: Array<Omit<MatchLabEvent, 'runId' | 'matchId' | 'at'>> = [];
    const emit = (event: Omit<MatchLabEvent, 'runId' | 'matchId' | 'at'>): void => {
      captured.push(event);
      artifacts.emit(auditCase.id, event);
    };
    const startedAt = new Date().toISOString();
    const started = performance.now();
    const timeout = AbortSignal.timeout(auditCase.plan.limits.timeoutMs);
    const signal = AbortSignal.any([stop.signal, timeout]);
    emit({ type: 'match_started', game: auditCase.game, data: { targetModel: auditCase.targetModel, opponentModel: auditCase.opponentModel, retry: auditCase.retry, limits: auditCase.plan.limits } });
    let result: MatchLabResult;
    try {
      result = await ADAPTERS[auditCase.game]({ plan: auditCase.plan, signal, emit });
      emit({ type: 'match_finished', game: auditCase.game, data: { status: result.status, actions: result.actionCount, reason: result.stopReason } });
    } catch (error) {
      result = failedResult(auditCase, startedAt, started, error);
      emit({ type: 'match_failed', game: auditCase.game, data: result.error });
    }
    await artifacts.writeResult(result);
    const row = classifyModelGameAudit(auditCase, result, captured);
    await writeFile(join(directory, 'matches', auditCase.id, 'audit.json'), `${JSON.stringify(row, null, 2)}\n`, 'utf8');
    const timing = depth === 'bench' ? `, p50 ${(row.stats.latencyMs.p50 / 1000).toFixed(1)}s, retries ${row.stats.retries}` : '';
    console.log(`${row.status.padEnd(10)} ${auditCase.game.padEnd(6)} ${auditCase.targetModel} (${row.targetActions} target action${row.targetActions === 1 ? '' : 's'}, ${row.durationMs}ms${timing})`);
    return row;
  };

  const attempts: ModelGameAuditRow[] = await runWorkerPool(cases, concurrency, runOne);
  const best = new Map(attempts.map((row) => [`${row.game}\0${row.targetModel}`, row]));
  const caseByKey = new Map(cases.map((entry) => [`${entry.game}\0${entry.targetModel}`, entry]));
  for (let retry = 1; retry <= retryAttempts; retry++) {
    const retryCases = [...best.entries()]
      .filter(([, row]) => shouldRetryModelGameAudit(row))
      .map(([key]) => retryModelMatrixCase(caseByKey.get(key)!, retry));
    if (retryCases.length === 0) break;
    console.log(`\nRetry ${retry}/${retryAttempts}: ${retryCases.length} soft failure${retryCases.length === 1 ? '' : 's'} serially`);
    for (const retryCase of retryCases) {
      const row = await runOne(retryCase);
      attempts.push(row);
      const key = `${row.game}\0${row.targetModel}`;
      best.set(key, betterModelGameAudit(best.get(key)!, row));
    }
  }

  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
  const rows = [...best.values()];
  const generatedAt = new Date().toISOString();
  const report = {
    schemaVersion: 1,
    runId,
    generatedAt,
    team: manifest.team,
    catalogSource: catalog.source,
    requestedModels: modelIds.length,
    requestedScenarios: cases.length,
    playable: rows.filter((row) => row.playable).length,
    nonPlayable: rows.filter((row) => !row.playable).length,
    results: rows,
    attempts,
  };
  artifacts.emit(undefined, { type: 'run_finished', data: { playable: report.playable, nonPlayable: report.nonPlayable } });
  await artifacts.flush();
  await writeFile(join(directory, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(join(directory, 'report.md'), `${modelGameAuditMarkdown(rows, {
    generatedAt,
    teamName: auth.team.name,
    teamSlug: auth.team.slug,
    catalogSource: catalog.source,
  })}\n`, 'utf8');
  if (depth === 'bench') {
    const entries = modelBenchEntries(rows, pricing);
    const bench = { schemaVersion: 1, generatedAt, team: manifest.team, catalogSource: catalog.source, games: selectedGames, scenarios: MODEL_MATRIX_SCENARIOS.bench, opponentModel, gitCommit: manifest.gitCommit, models: entries };
    const markdown = modelBenchMarkdown(entries, selectedGames, { generatedAt, teamName: auth.team.name, teamSlug: auth.team.slug });
    await writeFile(join(directory, 'bench.json'), `${JSON.stringify(bench, null, 2)}\n`, 'utf8');
    await writeFile(join(directory, 'bench.md'), `${markdown}\n`, 'utf8');
    if (publishDir) {
      await mkdir(publishDir, { recursive: true });
      await writeFile(join(publishDir, `model-bench.${auth.team.slug}.json`), `${JSON.stringify(bench, null, 2)}\n`, 'utf8');
      await writeFile(join(publishDir, `model-bench.${auth.team.slug}.md`), `${markdown}\n`, 'utf8');
      console.log(`\nPublished: ${join(publishDir, `model-bench.${auth.team.slug}.{json,md}`)}`);
    }
    for (const verdict of ['fast', 'ok', 'slow', 'broken'] as const) console.log(`${verdict}: ${entries.filter((entry) => entry.verdict === verdict).length}`);
  }
  console.log(`\nPlayable: ${report.playable}/${rows.length}`);
  console.log(`Summary: ${join(directory, 'summary.json')}`);
  console.log(`Report: ${join(directory, 'report.md')}`);
  if (args.includes('--strict') && report.nonPlayable > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`model-game-audit: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
