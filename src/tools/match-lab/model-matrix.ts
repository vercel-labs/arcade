import { DEFAULT_BIG_BLIND, DEFAULT_HANDS_PER_LEVEL, DEFAULT_SMALL_BLIND } from '../../rules/poker/blinds.ts';
import { STARTING_STACK } from '../../arcade/match/poker-session.ts';
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
}

export interface BuildModelMatrixOpts {
  games: readonly MatchLabGame[];
  models: readonly string[];
  opponentModel: string;
  seed: number;
  timeoutMs: number;
  retry?: number;
}

function limits(game: MatchLabGame, timeoutMs: number): MatchLabPlan['limits'] {
  return {
    timeoutMs,
    maxPlies: game === 'chess' ? 2 : 300,
    maxHands: game === 'poker' ? 1 : 100,
    maxActions: game === 'poker' ? 40 : game === 'catan' ? 2 : 20,
  };
}

export function buildModelMatrixCases(opts: BuildModelMatrixOpts): ModelGameAuditCase[] {
  const retry = opts.retry ?? 0;
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
          limits: limits(game, opts.timeoutMs),
          startingChips: STARTING_STACK,
          smallBlind: DEFAULT_SMALL_BLIND,
          bigBlind: DEFAULT_BIG_BLIND,
          handsPerLevel: DEFAULT_HANDS_PER_LEVEL,
          setupOnly: game === 'catan',
          communicationMode: 'autoreply',
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
  } else if (result.status === 'failed') status = 'ERROR';
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
