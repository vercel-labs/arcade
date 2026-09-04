import assert from 'node:assert/strict';
import test from 'node:test';

import { betterModelGameAudit, buildModelMatrixCases, classifyModelGameAudit, MODEL_MATRIX_SCENARIOS, modelBenchEntries, modelGameAuditStats, shouldRetryModelGameAudit } from './model-matrix.ts';
import type { MatchLabEvent, MatchLabResult } from './types.ts';

const result: MatchLabResult = {
  id: 'chess-0001',
  game: 'chess',
  status: 'bounded',
  models: ['target/model', 'opponent/model'],
  seed: 1,
  startedAt: '2026-08-26T00:00:00.000Z',
  endedAt: '2026-08-26T00:00:01.000Z',
  durationMs: 1_000,
  actionCount: 2,
  winnerSeats: [],
  stopReason: 'ply limit',
};

type CapturedEvent = Omit<MatchLabEvent, 'runId' | 'matchId' | 'at'>;

test('model matrix creates one target-first real-game scenario per model and game', () => {
  const cases = buildModelMatrixCases({
    games: ['chess', 'poker', 'islanders'],
    models: ['one/model', 'two/model'],
    opponentModel: 'baseline/model',
    seed: 42,
    timeoutMs: 60_000,
  });

  assert.equal(cases.length, 6);
  assert.deepEqual(cases.map((entry) => entry.plan.models), [
    ['one/model', 'baseline/model'],
    ['two/model', 'baseline/model'],
    ['one/model', 'baseline/model'],
    ['two/model', 'baseline/model'],
    ['one/model', 'baseline/model'],
    ['two/model', 'baseline/model'],
  ]);
  assert.equal(cases[0].plan.limits.maxPlies, 2);
  assert.equal(cases[2].plan.limits.maxHands, 1);
  assert.equal(cases[4].plan.setupOnly, true);
  assert.equal(cases[4].plan.limits.maxActions, 2);
});

test('model audit reads target diagnostics from both direct and nested match-lab events', () => {
  const [auditCase] = buildModelMatrixCases({ games: ['chess'], models: ['target/model'], opponentModel: 'opponent/model', seed: 1, timeoutMs: 1_000 });
  const direct: CapturedEvent[] = [{ type: 'action_chosen', game: 'chess', seat: 0, data: { diagnostics: { resolution: 'text' } } }];
  const nested: CapturedEvent[] = [{ type: 'action_chosen', game: 'poker', seat: 0, data: { choice: { diagnostics: { resolution: 'normalized' } } } }];

  assert.equal(classifyModelGameAudit(auditCase, result, direct).status, 'TEXT');
  assert.equal(classifyModelGameAudit(auditCase, result, nested).status, 'NORMALIZED');
});

test('model audit distinguishes unavailable random fallback and retries only soft failures', () => {
  const [auditCase] = buildModelMatrixCases({ games: ['chess'], models: ['target/model'], opponentModel: 'opponent/model', seed: 1, timeoutMs: 1_000 });
  const events: CapturedEvent[] = [{
    type: 'action_chosen',
    game: 'chess',
    seat: 0,
    data: { diagnostics: { resolution: 'random-fallback', fallbackReason: 'unavailable' } },
  }];
  const access = classifyModelGameAudit(auditCase, result, events);
  const noAction = classifyModelGameAudit(auditCase, result, []);

  assert.equal(access.status, 'ACCESS');
  assert.equal(shouldRetryModelGameAudit(access), false);
  assert.equal(noAction.status, 'NO_ACTION');
  assert.equal(shouldRetryModelGameAudit(noAction), true);
  assert.equal(betterModelGameAudit(noAction, access), noAction);
});

test('model audit preserves persistent Gateway failures as access failures', () => {
  const [auditCase] = buildModelMatrixCases({ games: ['chess'], models: ['target/model'], opponentModel: 'opponent/model', seed: 1, timeoutMs: 1_000 });
  const failed: MatchLabResult = {
    ...result,
    status: 'failed',
    stopReason: 'NotifiedModelFailure',
    error: { name: 'NotifiedModelFailure', message: 'out of credit', code: 'insufficient_funds' },
  };
  const row = classifyModelGameAudit(auditCase, failed, []);
  assert.equal(row.status, 'ACCESS');
  assert.equal(shouldRetryModelGameAudit(row), false);
});

test('bench depth plays long enough to time a model, and the stats read whole-decision latency, retries, rungs, and errors', () => {
  const [chess, poker, islanders] = buildModelMatrixCases({ games: ['chess', 'poker', 'islanders'], models: ['target/model'], opponentModel: 'opponent/model', seed: 1, timeoutMs: 1_000, depth: 'bench' });
  assert.equal(chess.plan.limits.maxPlies, MODEL_MATRIX_SCENARIOS.bench.chess.maxPlies);
  assert.equal(poker.plan.limits.maxHands, 2);
  assert.equal(islanders.plan.setupOnly, false, 'the bench plays past setup');
  assert.equal(islanders.plan.limits.maxActions, MODEL_MATRIX_SCENARIOS.bench.islanders.maxActions);
  const audit = buildModelMatrixCases({ games: ['islanders'], models: ['target/model'], opponentModel: 'opponent/model', seed: 1, timeoutMs: 1_000 })[0];
  assert.equal(audit.plan.setupOnly, true, 'the audit keeps its one-move question');

  const events: CapturedEvent[] = [
    { type: 'action_chosen', game: 'chess', seat: 0, data: { diagnostics: { resolution: 'structured', durationMs: 1_000, attempts: [{ inputTokens: 10, outputTokens: 2 }] } } },
    { type: 'action_chosen', game: 'chess', seat: 0, data: { diagnostics: { resolution: 'text', durationMs: 3_000, attempts: [{ inputTokens: 10 }, { inputTokens: 12, outputTokens: 3 }] } } },
    { type: 'action_chosen', game: 'chess', seat: 1, data: { diagnostics: { resolution: 'structured', durationMs: 99_000 } } },
    { type: 'model_attempt', game: 'chess', seat: 0, data: { result: 'error', raw: 'Service   temporarily unavailable' } },
    { type: 'model_attempt', game: 'chess', seat: 0, data: { result: 'error', raw: 'Service temporarily unavailable' } },
  ];
  const stats = modelGameAuditStats(events);
  assert.equal(stats.decisions, 2, 'the opponent seat is not counted');
  assert.equal(stats.retries, 1);
  assert.deepEqual(stats.latencyMs, { p50: 1_000, p90: 3_000, max: 3_000 });
  assert.deepEqual(stats.resolutions, { structured: 1, text: 1 });
  assert.deepEqual(stats.tokens, { input: 32, output: 5 });
  assert.deepEqual(stats.errors, ['Service temporarily unavailable']);

  const row = classifyModelGameAudit(chess, result, events);
  const slowRow = { ...row, game: 'poker' as const, stats: { ...row.stats, latencyMs: { p50: 25_000, p90: 40_000, max: 40_000 } } };
  const brokenRow = { ...row, targetModel: 'other/model', status: 'FALLBACK' as const, playable: false };
  const entries = modelBenchEntries([row, slowRow, brokenRow], new Map([['target/model', { input: 0, output: 0 }]]));
  assert.deepEqual(entries.map((entry) => [entry.model, entry.verdict, entry.free]), [['other/model', 'broken', undefined], ['target/model', 'slow', true]]);
  assert.equal(entries[1].games.chess?.p50Ms, 1_000);
});
