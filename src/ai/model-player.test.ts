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

// A mock returning fixed JSON strings in sequence — used as the normalizer (which
// IS structured-capable) and to exercise structured-move replies.
function jsonModel(replies: string[]): { model: MockLanguageModelV3; calls: () => number } {
  let calls = 0;
  const model = new MockLanguageModelV3({
    doGenerate: async () => okResult(replies[Math.min(calls++, replies.length - 1)]),
  });
  return { model, calls: () => calls };
}

// Prose with no token that parses to any legal move, so BOTH the structured call and
// the plain-text soft parse fail — forcing the normalization rung (rung 4).
const UNPARSEABLE = 'Let me consider my options here, weighing the position carefully.';

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
  const { action, rationale, diagnostics } = await player.chooseAction(state);
  assert.equal(rationale, FALLBACK_RATIONALE.unavailable, 'diagnosed as unavailable, not a generic fallback');
  assert.equal(calls(), 1, 'exactly one call — no schema retries, no wasted text-fallback call');
  assert.ok(legalMove(state, action), 'still returns a legal move so the match never deadlocks');
  assert.equal(diagnostics?.resolution, 'random-fallback');
  assert.equal(diagnostics?.fallbackReason, 'unavailable');
  assert.deepEqual(diagnostics?.attempts.map(({ phase, result, failureKind }) => ({ phase, result, failureKind })), [
    { phase: 'structured', result: 'error', failureKind: 'access' },
  ]);
  assert.ok(!JSON.stringify(diagnostics).includes('restricted access'), 'diagnostics contain no raw provider error text');
});

test('schema error: falls through to the plain-text soft-parse and plays a legal move', async () => {
  // This is the Inkling rescue: on a team WITH provider access, the model can\'t emit
  // the JSON schema but answers fine in prose — the text fallback must succeed.
  const state = new ChessState();
  const { model, calls } = proseModel('I will develop toward the center.\nMOVE: e4');
  const player = new ModelPlayer<Move>({ model, name: 'prose-mock', gameName: 'chess', maxRetries: 1 });
  const { action, rationale, diagnostics } = await player.chooseAction(state);
  assert.equal(state.actionToString(action), 'e4');
  assert.ok(!isFallbackRationale(rationale), 'a real move, not a fallback');
  assert.ok(calls() >= 2, 'ran the structured call then the text fallback');
  assert.equal(diagnostics?.resolution, 'text');
  assert.equal(diagnostics?.attempts.at(-1)?.phase, 'text');
  assert.equal(diagnostics?.attempts.at(-1)?.result, 'accepted');
  assert.equal(diagnostics?.attempts.at(-1)?.inputTokens, 1);
  assert.equal(diagnostics?.attempts.at(-1)?.outputTokens, 1);
  assert.ok(!JSON.stringify(diagnostics).includes('develop toward the center'), 'diagnostics contain no model prose');
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
  const { action, rationale, diagnostics } = await player.chooseAction(state);
  assert.equal(rationale, FALLBACK_RATIONALE.exhausted, 'generic "no valid reply" fallback, not "unavailable"');
  assert.ok(legalMove(state, action), 'random legal move played');
  // Structured succeeded (valid JSON) but the move was illegal every time → retries
  // are structured-only; the text fallback is NOT triggered (that\'s for schema errors).
  assert.equal(calls, 3, 'maxRetries(2)+1 structured attempts, no text calls');
  assert.equal(diagnostics?.resolution, 'random-fallback');
  assert.equal(diagnostics?.fallbackReason, 'exhausted');
  assert.deepEqual(diagnostics?.attempts.map(({ phase, result, rejectionReason }) => ({ phase, result, rejectionReason })), [
    { phase: 'structured', result: 'rejected', rejectionReason: 'illegal' },
    { phase: 'structured', result: 'rejected', rejectionReason: 'illegal' },
    { phase: 'structured', result: 'rejected', rejectionReason: 'illegal' },
  ]);
});

test('last-resort fallback uses the injected RNG', async () => {
  const state = new ChessState();
  const legal = state.legalActions();
  const { model } = jsonModel(['{"move":"zz99","rationale":"no valid move"}']);
  const player = new ModelPlayer<Move>({
    model,
    name: 'seeded-fallback',
    maxRetries: 0,
    fallbackRng: () => 0.999999,
  });
  const choice = await player.chooseAction(state);
  assert.deepEqual(choice.action, legal.at(-1));
  assert.equal(choice.diagnostics?.resolution, 'random-fallback');
});

test('cancellation: an aborted signal propagates instead of silently falling back', async () => {
  const state = new ChessState();
  const { model } = throwingModel(accessError()); // any throw; abort should win first
  const player = new ModelPlayer<Move>({ model, name: 'cancel-mock', gameName: 'chess' });
  await assert.rejects(() => player.chooseAction(state, { signal: AbortSignal.abort() }));
});

test('malformed JSON structured reply still yields a move via the text fallback', async () => {
  const state = new ChessState();
  const { model } = proseModel('{"move": "e4", oops not valid json'); // Output.object can\'t parse → schema error
  const player = new ModelPlayer<Move>({ model, name: 'broken-json', gameName: 'chess', maxRetries: 1 });
  const { action } = await player.chooseAction(state);
  // The same reply is soft-parsed as text; "e4" is recovered as a token.
  assert.equal(state.actionToString(action), 'e4');
});

test('ambiguous move is re-prompted, then a clear move is accepted', async () => {
  // Two knights reach d2; a bare "Nd2" is ambiguous (actionFromString → null) so it
  // must be re-prompted rather than guessed. "Nbd2" then resolves.
  const state = new ChessState('7k/8/8/8/8/5N2/8/1N2K3 w - - 0 1');
  const { model } = jsonModel(['{"move":"Nd2","rationale":"a"}', '{"move":"Nbd2","rationale":"b"}']);
  const player = new ModelPlayer<Move>({ model, name: 'amb', gameName: 'chess', maxRetries: 2 });
  const { action } = await player.chooseAction(state);
  assert.equal(state.actionToString(action), 'Nbd2');
});

test('normalization rung: recovers a legal move from an otherwise unparseable answer', async () => {
  const state = new ChessState();
  const { model, calls: modelCalls } = proseModel(UNPARSEABLE);
  const { model: normalizer, calls: normCalls } = jsonModel(['{"move":"e4"}']);
  const player = new ModelPlayer<Move>({ model, name: 'stubborn', gameName: 'chess', maxRetries: 0, normalizer, normalizerName: 'norm' });
  const { action, rationale, diagnostics } = await player.chooseAction(state);
  assert.equal(state.actionToString(action), 'e4', 'normalizer recovered a legal move');
  assert.ok(!isFallbackRationale(rationale), 'a real (normalized) move, not a random fallback');
  assert.equal(normCalls(), 1, 'normalizer was called exactly once');
  assert.ok(modelCalls() >= 2, 'only after the structured + text rungs failed');
  assert.equal(diagnostics?.resolution, 'normalized');
  assert.equal(diagnostics?.normalizerModel, 'norm');
  assert.equal(diagnostics?.attempts.at(-1)?.phase, 'normalize');
  assert.equal(diagnostics?.attempts.at(-1)?.result, 'accepted');
});

test('normalization rung: normalizer picks an illegal move → diagnosed random fallback', async () => {
  const state = new ChessState();
  const { model } = proseModel(UNPARSEABLE);
  const { model: normalizer } = jsonModel(['{"move":"zz99"}']); // not a legal move
  const player = new ModelPlayer<Move>({ model, name: 'stubborn', gameName: 'chess', maxRetries: 0, normalizer });
  const { rationale } = await player.chooseAction(state);
  assert.equal(rationale, FALLBACK_RATIONALE.exhausted, 'normalization failed → last-resort fallback, still diagnosed');
});

test('normalization honors cancellation', async () => {
  const state = new ChessState();
  const controller = new AbortController();
  const { model } = proseModel(UNPARSEABLE);
  // The normalizer aborts mid-pass; ModelPlayer must propagate, not fall back silently.
  const normalizer = new MockLanguageModelV3({
    doGenerate: async () => {
      controller.abort();
      throw new Error('aborted mid-normalize');
    },
  });
  const player = new ModelPlayer<Move>({ model, name: 'stubborn', gameName: 'chess', maxRetries: 0, normalizer });
  await assert.rejects(() => player.chooseAction(state, { signal: controller.signal }));
});

test('private-context safety: a normalized split-mode move never surfaces private reasoning', async () => {
  // Split/speech mode (poker): the model reasons privately, then a public SAY: line.
  // Even when normalization recovers the move, the surfaced rationale must be ONLY
  // the SAY: line — never the "thinking" that reveals the hand.
  const state = new ChessState();
  const leaky = 'THINKING: My hand is monstrous, pocket kings, I will crush them.\nSAY: Feeling lucky tonight.';
  const { model } = proseModel(leaky); // no parseable move token → soft parse fails
  const { model: normalizer } = jsonModel(['{"move":"e4"}']);
  const player = new ModelPlayer<Move>({
    model,
    name: 'poker-bot',
    gameName: 'poker',
    speech: 'A short line you say out loud to the table.',
    maxRetries: 0,
    normalizer,
  });
  const { action, rationale } = await player.chooseAction(state);
  assert.equal(state.actionToString(action), 'e4', 'move recovered');
  assert.equal(rationale, 'Feeling lucky tonight.', 'surfaced rationale is the public SAY line');
  assert.ok(!/monstrous|pocket kings|crush|THINKING/i.test(rationale ?? ''), 'no private reasoning leaked');
});

test('structured communication stays separate from rationale for host-policy gating', async () => {
  const state = new ChessState();
  const { model } = jsonModel([JSON.stringify({
    thinking: 'private calculation',
    move: 'e4',
    communication: { mode: 'speak', intent: 'banter', text: 'Your move.' },
  })]);
  const choice = await new ModelPlayer<Move>({
    model,
    gameName: 'table chess',
    communication: { mode: () => 'ambient', guide: 'Speak only when useful.' },
  }).chooseAction(state);
  assert.equal(state.actionToString(choice.action), 'e4');
  assert.equal(choice.rationale, undefined);
  assert.deepEqual(choice.communication, { mode: 'speak', intent: 'banter', text: 'Your move.' });
});

test('communication-mode text fallback never broadcasts private fallback prose', async () => {
  const state = new ChessState();
  const { model } = proseModel('My private calculation is complicated.\nMOVE: e4');
  const choice = await new ModelPlayer<Move>({
    model,
    gameName: 'table chess',
    communication: { mode: () => 'ambient', guide: 'Speak selectively.' },
  }).chooseAction(state);
  assert.equal(state.actionToString(choice.action), 'e4');
  assert.equal(choice.rationale, undefined);
  assert.equal(choice.communication, undefined);
});

test('structured success returns sanitized timing and token diagnostics', async () => {
  const state = new ChessState();
  const { model } = jsonModel(['{"move":"e4","rationale":"private-to-the-record-layer"}']);
  const choice = await new ModelPlayer<Move>({ model, name: 'structured', gameName: 'chess' }).chooseAction(state);
  assert.equal(choice.diagnostics?.resolution, 'structured');
  assert.equal(choice.diagnostics?.illegalMode, false);
  assert.ok((choice.diagnostics?.durationMs ?? -1) >= 0);
  assert.deepEqual(choice.diagnostics?.attempts.map(({ phase, sequence, result, inputTokens, outputTokens }) => ({ phase, sequence, result, inputTokens, outputTokens })), [
    { phase: 'structured', sequence: 0, result: 'accepted', inputTokens: 1, outputTokens: 1 },
  ]);
  assert.ok(!JSON.stringify(choice.diagnostics).includes('private-to-the-record-layer'));
});

test('illegal mode labels an unparseable reply without calling it an illegal move', async () => {
  const state = new ChessState();
  const { model } = jsonModel(['{"move":"zz99","rationale":"no move"}']);
  const choice = await new ModelPlayer<Move>({
    model,
    name: 'loose',
    gameName: 'chess',
    maxRetries: 0,
    allowIllegal: () => true,
  }).chooseAction(state);
  assert.equal(choice.diagnostics?.illegalMode, true);
  assert.equal(choice.diagnostics?.resolution, 'random-fallback');
  assert.equal(choice.diagnostics?.attempts[0]?.result, 'rejected');
  assert.equal(choice.diagnostics?.attempts[0]?.rejectionReason, 'unparseable');
});
