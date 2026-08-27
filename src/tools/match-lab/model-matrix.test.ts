import assert from 'node:assert/strict';
import test from 'node:test';

import { betterModelGameAudit, buildModelMatrixCases, classifyModelGameAudit, shouldRetryModelGameAudit } from './model-matrix.ts';
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
    games: ['chess', 'poker', 'catan'],
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
