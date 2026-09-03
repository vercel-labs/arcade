import assert from 'node:assert/strict';
import test from 'node:test';
import { runWorkerPool, summarizeRun } from './artifacts.ts';
import type { MatchLabManifest, MatchLabResult } from './types.ts';

test('worker pool preserves input order while bounding concurrency', async () => {
  let active = 0;
  let peak = 0;
  const results = await runWorkerPool([4, 3, 2, 1], 2, async (value) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, value));
    active--;
    return value * 2;
  });
  assert.deepEqual(results, [8, 6, 4, 2]);
  assert.equal(peak, 2);
});

test('summary attributes wins to the model occupying each seat', () => {
  const manifest: MatchLabManifest = {
    schemaVersion: 1,
    runId: 'run',
    createdAt: '2026-01-01T00:00:00.000Z',
    game: 'chess',
    games: 2,
    concurrency: 1,
    models: ['a', 'b'],
    baseSeed: 1,
    swapSeats: true,
    setupOnly: false,
    communicationMode: 'autoreply',
    harness: 'current',
    captureThinking: false,
    startingChips: 1_000,
    smallBlind: 10,
    bigBlind: 20,
    handsPerLevel: 15,
    limits: { timeoutMs: 1_000, maxActions: 10, maxPlies: 10, maxHands: 10 },
    telemetry: 'disabled',
  };
  const base: MatchLabResult = {
    id: 'one', game: 'chess', status: 'completed', models: ['a', 'b'], seed: 1,
    startedAt: manifest.createdAt, endedAt: manifest.createdAt, durationMs: 0,
    actionCount: 1, winnerSeats: [0], stopReason: 'checkmate',
  };
  const summary = summarizeRun(manifest, manifest.createdAt, [base, { ...base, id: 'two', models: ['b', 'a'], winnerSeats: [1] }]);
  assert.deepEqual(summary.resultsByModel.a, { games: 2, wins: 2 });
  assert.deepEqual(summary.resultsByModel.b, { games: 2, wins: 0 });
});
