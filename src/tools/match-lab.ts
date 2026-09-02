// Cross-game, headless AI match runner. It records detailed local artifacts and
// deliberately disables telemetry: match-lab traffic must never silently populate
// production leaderboards.

process.env.ARCADE_TELEMETRY = '0';

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { ensureCachedGatewayKey } from '../auth/index.ts';
import { MatchLabArtifacts, runWorkerPool, summarizeRun } from './match-lab/artifacts.ts';
import { runIslandersMatchLab } from './match-lab/adapters/islanders.ts';
import { runChessMatch } from './match-lab/adapters/chess.ts';
import { runPokerMatchLab } from './match-lab/adapters/poker.ts';
import { buildMatchPlans, parseMatchLabConfig } from './match-lab/config.ts';
import type { MatchLabAdapter, MatchLabGame, MatchLabManifest, MatchLabResult } from './match-lab/types.ts';
import { NotifiedModelFailure } from '../harness/model-failure-notice.ts';

const ADAPTERS: Record<MatchLabGame, MatchLabAdapter> = {
  chess: runChessMatch,
  islanders: runIslandersMatchLab,
  poker: runPokerMatchLab,
};

function usage(): void {
  console.log(`Arcade AI match lab

Usage:
  pnpm match:run -- --game chess [options]
  pnpm match:run -- --game islanders [options]
  pnpm match:run -- --game poker [options]

Options:
  --models=a,b,...       Gateway model slugs (game-specific defaults)
  --games=N              Number of matches (default 1)
  --concurrency=N        Matches in flight at once (default 1)
  --seed=N               Base deterministic rules seed
  --swap-seats           Rotate model seats between matches
  --timeout=N            Per-match timeout in seconds (default 600)
  --max-plies=N          Chess ply bound (default 300)
  --max-actions=N        Islanders/Poker action bound
  --max-hands=N          Poker hand bound (default 100)
  --starting-chips=N     Poker chips per player (default 1000)
  --small-blind=N        Poker initial small blind (default 10)
  --big-blind=N          Poker initial big blind (default 20)
  --hands-per-level=N    Completed hands per blind level (default 15)
  --setup-only           Stop Islanders after initial placements
  --communication=MODE   Autoreply or ambient communication (Islanders defaults ambient; others autoreply)
  --output=PATH          Artifact directory (default .runs/<timestamp>-<game>)

Telemetry is always disabled. Results are local files only.`);
}

function gitCommit(): string | undefined {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return undefined;
  }
}

function failure(plan: ReturnType<typeof buildMatchPlans>[number], startedAt: string, started: number, error: unknown): MatchLabResult {
  const cause = error instanceof Error ? error : new Error(String(error));
  const endedAt = new Date().toISOString();
  return {
    id: plan.id,
    game: plan.game,
    status: 'failed',
    models: plan.models,
    seed: plan.seed,
    startedAt,
    endedAt,
    durationMs: Math.max(0, Math.round(performance.now() - started)),
    actionCount: 0,
    winnerSeats: [],
    stopReason: cause.name,
    error: {
      name: cause.name,
      message: cause.message,
      ...(error instanceof NotifiedModelFailure ? { code: error.notice.code } : {}),
      ...(cause.stack ? { stack: cause.stack } : {}),
    },
  };
}

async function main(): Promise<void> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    usage();
    return;
  }
  const config = parseMatchLabConfig(process.argv.slice(2));
  const auth = await ensureCachedGatewayKey();
  if (!auth?.team) throw new Error('No cached Arcade login/team. Run `pnpm dev --login` once.');
  const runId = randomUUID();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const directory = config.output ?? resolve('.runs', `${stamp}-${config.game}`);
  const createdAt = new Date().toISOString();
  const commit = gitCommit();
  const manifest: MatchLabManifest = {
    schemaVersion: 1,
    runId,
    createdAt,
    game: config.game,
    games: config.games,
    concurrency: config.concurrency,
    models: config.models,
    baseSeed: config.seed,
    swapSeats: config.swapSeats,
    setupOnly: config.setupOnly,
    communicationMode: config.communicationMode,
    startingChips: config.startingChips,
    smallBlind: config.smallBlind,
    bigBlind: config.bigBlind,
    handsPerLevel: config.handsPerLevel,
    limits: config.limits,
    ...(commit ? { gitCommit: commit } : {}),
    telemetry: 'disabled',
  };
  const artifacts = new MatchLabArtifacts(directory, runId);
  await artifacts.initialize(manifest);
  artifacts.emit(undefined, { type: 'run_started', game: config.game, data: manifest });
  const plans = buildMatchPlans(config);
  const stop = new AbortController();
  const interrupt = (): void => stop.abort(new Error('interrupted'));
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);

  console.log(`AI Gateway team: ${auth.team.name} (${auth.team.slug})`);
  console.log(`Run: ${runId}`);
  console.log(`Artifacts: ${directory}`);
  console.log(`Telemetry: disabled`);
  console.log(`Starting ${plans.length} ${config.game} match${plans.length === 1 ? '' : 'es'} with concurrency ${Math.min(config.concurrency, plans.length)}\n`);

  const results = await runWorkerPool(plans, config.concurrency, async (plan) => {
    const startedAt = new Date().toISOString();
    const started = performance.now();
    const timeout = AbortSignal.timeout(plan.limits.timeoutMs);
    const signal = AbortSignal.any([stop.signal, timeout]);
    artifacts.emit(plan.id, { type: 'match_started', game: plan.game, data: { models: plan.models, seed: plan.seed, limits: plan.limits } });
    console.log(`[${plan.id}] started — ${plan.models.join(' vs ')}`);
    let result: MatchLabResult;
    try {
      result = await ADAPTERS[plan.game]({ plan, signal, emit: (event) => artifacts.emit(plan.id, event) });
      artifacts.emit(plan.id, { type: 'match_finished', game: plan.game, data: { status: result.status, actions: result.actionCount, winners: result.winnerSeats, reason: result.stopReason } });
    } catch (error) {
      result = failure(plan, startedAt, started, error);
      artifacts.emit(plan.id, { type: 'match_failed', game: plan.game, data: result.error });
    }
    await artifacts.writeResult(result);
    console.log(`[${plan.id}] ${result.status} — ${result.actionCount} actions, ${result.stopReason}`);
    return result;
  });

  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
  const summary = summarizeRun(manifest, createdAt, results);
  artifacts.emit(undefined, { type: 'run_finished', game: config.game, data: summary });
  await artifacts.writeSummary(summary);
  console.log(`\nFinished: ${summary.completed} completed, ${summary.bounded} bounded, ${summary.failed} failed`);
  console.log(`Summary: ${resolve(directory, 'summary.json')}`);
  if (summary.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`match-lab: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
