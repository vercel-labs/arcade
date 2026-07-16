import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockLanguageModelV3 } from 'ai/test';
import { ChessState } from '../rules/chess/chess.ts';
import { FALLBACK_RATIONALE, isFallbackRationale, ModelPlayer } from './model-player.ts';
import type { Move } from '../rules/chess/types.ts';

type GenResult = Awaited<ReturnType<MockLanguageModelV3['doGenerate']>>;
const okResult = (text: string): GenResult =>
  ({
    content: [{ type: 'text', text }],
    finishReason: { unified: 'stop', raw: undefined },
    usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
    warnings: [],
  }) as unknown as GenResult;

// A mock whose every generation call throws `err`, counting how many times it ran —
// so a test can prove ModelPlayer did NOT waste a second (text) call.
function throwingModel(err: unknown): { model: MockLanguageModelV3; calls: () => number } {
  let calls = 0;
  const model = new MockLanguageModelV3({
    doGenerate: async () => {
      calls++;
      throw err;
    },
  });
  return { model, calls: () => calls };
}

// A mock that returns raw prose (not JSON): the structured Output.object call can't
// parse it → a schema-class error → ModelPlayer drops to the plain-text soft parse,
// which reads this same prose. Counts calls so we can see the text path did run.
function proseModel(text: string): { model: MockLanguageModelV3; calls: () => number } {
  let calls = 0;
  const model = new MockLanguageModelV3({
    doGenerate: async () => {
      calls++;
      return okResult(text);
    },
  });
  return { model, calls: () => calls };
}

// The gateway shape when a team can't reach a provider (see model-errors.test.ts):
// top-level 403 + a cause carrying `no_providers_available`.
function accessError(): unknown {
  const cause = Object.assign(new Error('restricted'), {
    name: 'AI_APICallError',
    statusCode: 403,
    responseBody: JSON.stringify({ error: { type: 'no_providers_available', message: 'restricted access to provider baseten' } }),
  });
  return Object.assign(new Error('Your team has restricted access to this provider.'), { name: 'GatewayInternalServerError', statusCode: 403, cause });
}

const legalMove = (state: ChessState, action: Move): boolean =>
  state.legalActions().some((m) => m.from === action.from && m.to === action.to && m.promotion === action.promotion);

test('access error: skips the futile text retry and returns the "unavailable" diagnosis', async () => {
  const state = new ChessState();
  const { model, calls } = throwingModel(accessError());
  const player = new ModelPlayer<Move>({ model, name: 'inkling-mock', gameName: 'chess', maxRetries: 3 });
  const { action, rationale } = await player.chooseAction(state);
  assert.equal(rationale, FALLBACK_RATIONALE.unavailable, 'diagnosed as unavailable, not a generic fallback');
  assert.equal(calls(), 1, 'exactly one call — no schema retries, no wasted text-fallback call');
  assert.ok(legalMove(state, action), 'still returns a legal move so the match never deadlocks');
});

test('schema error: falls through to the plain-text soft-parse and plays a legal move', async () => {
  // This is the Inkling rescue: on a team WITH provider access, the model can\'t emit
  // the JSON schema but answers fine in prose — the text fallback must succeed.
  const state = new ChessState();
  const { model, calls } = proseModel('I will develop toward the center.\nMOVE: e4');
  const player = new ModelPlayer<Move>({ model, name: 'prose-mock', gameName: 'chess', maxRetries: 1 });
  const { action, rationale } = await player.chooseAction(state);
  assert.equal(state.actionToString(action), 'e4');
  assert.ok(!isFallbackRationale(rationale), 'a real move, not a fallback');
  assert.ok(calls() >= 2, 'ran the structured call then the text fallback');
});

test('exhausted (legal JSON but always illegal move): diagnosed generic fallback, text path not used', async () => {
  const state = new ChessState();
  let calls = 0;
  const model = new MockLanguageModelV3({
    doGenerate: async () => {
      calls++;
      return okResult(JSON.stringify({ move: 'zz99', rationale: 'always nonsense' }));
    },
  });
  const player = new ModelPlayer<Move>({ model, name: 'illegal-mock', gameName: 'chess', maxRetries: 2 });
  const { action, rationale } = await player.chooseAction(state);
  assert.equal(rationale, FALLBACK_RATIONALE.exhausted, 'generic "no valid reply" fallback, not "unavailable"');
  assert.ok(legalMove(state, action), 'random legal move played');
  // Structured succeeded (valid JSON) but the move was illegal every time → retries
  // are structured-only; the text fallback is NOT triggered (that\'s for schema errors).
  assert.equal(calls, 3, 'maxRetries(2)+1 structured attempts, no text calls');
});

test('cancellation: an aborted signal propagates instead of silently falling back', async () => {
  const state = new ChessState();
  const { model } = throwingModel(accessError()); // any throw; abort should win first
  const player = new ModelPlayer<Move>({ model, name: 'cancel-mock', gameName: 'chess' });
  await assert.rejects(() => player.chooseAction(state, { signal: AbortSignal.abort() }));
});
