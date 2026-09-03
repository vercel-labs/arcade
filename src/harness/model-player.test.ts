import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockLanguageModelV3 } from 'ai/test';
import { z } from 'zod';
import { ChessState } from '../rules/chess/chess.ts';
import {
  communicationFromResponse,
  communicationFromText,
  communicationResponseSchema,
  FALLBACK_RATIONALE,
  isFallbackRationale,
  ModelPlayer,
} from './model-player.ts';
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

function billingError(): unknown {
  const cause = Object.assign(new Error('out of credit'), {
    name: 'AI_APICallError', statusCode: 402,
    responseBody: JSON.stringify({ error: { type: 'insufficient_funds', message: 'Add credits at https://provider.invalid' } }),
  });
  return Object.assign(new Error('out of credit'), { name: 'GatewayInternalServerError', statusCode: 402, cause });
}

function transientError(): unknown {
  return Object.assign(new Error('temporarily unavailable'), {
    name: 'AI_APICallError',
    statusCode: 503,
    responseBody: JSON.stringify({ error: { type: 'service_unavailable', message: 'try again' } }),
  });
}

const legalMove = (state: ChessState, action: Move): boolean =>
  state.legalActions().some((m) => m.from === action.from && m.to === action.to && m.promotion === action.promotion);

test('communication response schema stays flat for strict structured-output providers', () => {
  const schema = z.toJSONSchema(communicationResponseSchema);
  assert.equal(JSON.stringify(schema).includes('oneOf'), false);
  assert.deepEqual(schema.required, ['mode', 'intent', 'text', 'privateReason', 'respondsTo', 'addressedSeats']);
});

test('flat communication responses normalize into the public discriminated union', () => {
  assert.deepEqual(communicationFromResponse({
    mode: 'silent', intent: 'reply', text: 'ignored', privateReason: 'routine', respondsTo: 'ignored', addressedSeats: [1],
  }), { mode: 'silent', intent: 'none', privateReason: 'routine' });
  assert.deepEqual(communicationFromResponse({
    mode: 'speak', intent: 'negotiate', text: ' Trade? ', privateReason: '', respondsTo: ' message-1 ', addressedSeats: [1],
  }), { mode: 'speak', intent: 'negotiate', text: 'Trade?', respondsTo: 'message-1', addressedSeats: [1] });
  assert.equal(communicationFromResponse({
    mode: 'speak', intent: 'none', text: '', privateReason: '', respondsTo: '', addressedSeats: [],
  }), undefined);
});

test('marker-based communication fallback never treats unmarked private prose as public speech', () => {
  assert.equal(communicationFromText('I should hide my plan and complain about that road.'), undefined);
  assert.deepEqual(communicationFromText('INTENT: none\nSAY:\nPRIVATE: routine'), {
    mode: 'silent', intent: 'none', privateReason: 'routine',
  });
  assert.deepEqual(communicationFromText('thinking privately\nINTENT: react\nSAY: That road cuts me off.\nPRIVATE: directly affected'), {
    mode: 'speak', intent: 'react', text: 'That road cuts me off.', privateReason: 'directly affected',
  });
  assert.deepEqual(communicationFromText('INTENT: reply\nSAY: I can make that trade.\nADDRESS: 0, 2\nRESPONDS TO: talk-7\nPRIVATE: useful deal'), {
    mode: 'speak', intent: 'reply', text: 'I can make that trade.', privateReason: 'useful deal', respondsTo: 'talk-7', addressedSeats: [0, 2],
  });
});

test('access error: skips the futile text retry and surfaces a notice instead of fallback chat', async () => {
  const state = new ChessState();
  const { model, calls } = throwingModel(accessError());
  const notices: unknown[] = [];
  const player = new ModelPlayer<Move>({ model, name: 'inkling-mock', gameName: 'chess', maxRetries: 3, onFailureNotice: (notice) => notices.push(notice) });
  await assert.rejects(() => player.chooseAction(state), { name: 'NotifiedModelFailure' });
  assert.equal(calls(), 1, 'exactly one call — no schema retries, no wasted text-fallback call');
  assert.equal(notices.length, 1);
});

test('Gateway billing failure emits an actionable notice without generic fallback chat', async () => {
  const state = new ChessState();
  const { model, calls } = throwingModel(billingError());
  const notices: unknown[] = [];
  const player = new ModelPlayer<Move>({ model, name: 'openai/test', maxRetries: 3, onFailureNotice: (notice) => notices.push(notice) });
  await assert.rejects(() => player.chooseAction(state), { name: 'NotifiedModelFailure' });
  assert.equal(calls(), 1);
  assert.deepEqual(notices, [{
    code: 'insufficient_funds', severity: 'error', title: 'out of credit',
    body: 'buy AI Gateway credit to resume model requests.', persistent: true,
    action: { label: 'buy AI Gateway credit', url: 'https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%3Fmodal%3Dtop-up' },
  }]);
});

test('temporary Gateway failure notifies and continues with a legal fallback', async () => {
  const state = new ChessState();
  const { model } = throwingModel(transientError());
  const notices: unknown[] = [];
  const player = new ModelPlayer<Move>({ model, name: 'temporary-model', gameName: 'chess', maxRetries: 0, fallbackRng: () => 0, onFailureNotice: (notice) => notices.push(notice) });
  const choice = await player.chooseAction(state);
  assert.equal(legalMove(state, choice.action), true);
  assert.equal(choice.diagnostics?.resolution, 'random-fallback');
  assert.equal(notices.length, 1);
  assert.equal((notices[0] as { persistent: boolean }).persistent, false);
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
  const notices: unknown[] = [];
  const player = new ModelPlayer<Move>({ model, name: 'illegal-mock', gameName: 'chess', maxRetries: 2, onFailureNotice: (notice) => notices.push(notice) });
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
  assert.deepEqual(notices, []);
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
    communication: {
      mode: 'speak',
      intent: 'banter',
      text: 'Your move.',
      privateReason: 'friendly table talk',
      respondsTo: '',
      addressedSeats: [],
    },
  })]);
  const choice = await new ModelPlayer<Move>({
    model,
    gameName: 'table chess',
    communication: { mode: () => 'ambient', guide: 'Speak only when useful.' },
  }).chooseAction(state);
  assert.equal(state.actionToString(choice.action), 'e4');
  assert.equal(choice.rationale, undefined);
  assert.deepEqual(choice.communication, {
    mode: 'speak', intent: 'banter', text: 'Your move.', privateReason: 'friendly table talk',
  });
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

test('communication-mode text fallback preserves explicit public speech for schema-incompatible models', async () => {
  const state = new ChessState();
  const { model, calls } = proseModel('Private calculation stays here.\nINTENT: banter\nSAY: Your center is looking shaky.\nPRIVATE: worthwhile table talk\nMOVE: e4');
  const choice = await new ModelPlayer<Move>({
    model,
    gameName: 'table chess',
    communication: { mode: () => 'ambient', guide: 'Speak selectively.' },
  }).chooseAction(state);
  assert.equal(calls(), 2, 'structured failure falls back to one plain-text generation');
  assert.equal(state.actionToString(choice.action), 'e4');
  assert.deepEqual(choice.communication, {
    mode: 'speak', intent: 'banter', text: 'Your center is looking shaky.', privateReason: 'worthwhile table talk',
  });
});

test('reaction-only communication falls back to explicit markers when structured output is unsupported', async () => {
  const { model, calls } = proseModel('INTENT: react\nSAY: You just boxed in my road.\nPRIVATE: directly affected');
  const player = new ModelPlayer<Move>({
    model,
    gameName: 'Islanders',
    communication: { mode: () => 'ambient', guide: 'Speak selectively.' },
  });
  const communication = await player.chooseCommunication({
    opportunity: {
      seat: 1,
      expectation: 'encouraged',
      reason: 'directly affected by the moment',
      moment: {
        id: 'islanders-1-1', game: 'islanders', type: 'contested_route', actorSeat: 0,
        affectedSeats: [1], relevantSeats: [1], strength: 'notable', importance: 0.82,
        publicSummary: 'Red built into Blue’s route.', publicFacts: [],
        suggestedIntents: ['react', 'banter'], responseExpectation: 'encouraged',
      },
    },
    gameView: 'Your public position and private hand.',
    conversation: 'No recent speech.',
  });
  assert.equal(calls(), 2, 'structured failure falls back to one plain-text generation');
  assert.deepEqual(communication, {
    mode: 'speak', intent: 'react', text: 'You just boxed in my road.', privateReason: 'directly affected',
  });
});

test('reaction prompt explicitly distinguishes the reacting model from the action actor', async () => {
  let request = '';
  const model = new MockLanguageModelV3({
    doGenerate: async (options) => {
      request = JSON.stringify(options.prompt);
      return okResult(JSON.stringify({ mode: 'silent', intent: 'none', text: '', privateReason: 'no comment', respondsTo: '', addressedSeats: [] }));
    },
  });
  const player = new ModelPlayer<Move>({
    model,
    name: 'Claude',
    gameName: 'Islanders',
    communication: { mode: () => 'ambient', guide: 'Speak selectively.' },
  });
  await player.chooseCommunication({
    opportunity: {
      seat: 1,
      expectation: 'encouraged',
      reason: 'directly affected by the moment',
      moment: {
        id: 'islanders-12-1', game: 'islanders', type: 'robber_attack', actorSeat: 0, actorLabel: 'the human player',
        affectedSeats: [1], affectedLabels: ['Claude'], relevantSeats: [1], strength: 'notable', importance: 0.84,
        publicSummary: 'the human player moved the robber and targeted Claude.', publicFacts: [],
        suggestedIntents: ['react'], responseExpectation: 'encouraged',
      },
    },
    gameView: 'Islanders, 2 players. You are Claude.',
    conversation: '',
  });
  assert.match(request, /YOU ARE THE REACTING PLAYER: Claude\./);
  assert.match(request, /ACTION ACTOR: the human player\./);
  assert.match(request, /DIRECTLY AFFECTED PLAYERS: Claude\./);
  assert.match(request, /You did not perform it/);
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

test('captureThinking is opt-in: attempts carry private reasoning, feedback, and context only when asked', async () => {
  const replies = [
    JSON.stringify({ thinking: 'The knight on b1 wants f3, but e4 first.', move: 'Qh5', say: 'Queen out early.' }),
    JSON.stringify({ thinking: 'Right, Qh5 is not legal from the start; e4 it is.', move: 'e4', say: 'Center pawn.' }),
  ];
  const quiet: Record<string, unknown>[] = [];
  const quietPlayer = new ModelPlayer<Move>({
    model: jsonModel(replies).model,
    name: 'test/quiet',
    gameName: 'chess',
    speech: 'one sentence',
    contextProvider: () => 'Your private notebook: plan: develop fast.',
    onAttempt: (info) => quiet.push({ ...info }),
  });
  await quietPlayer.chooseAction(new ChessState());
  assert.equal(quiet.length, 2);
  assert.ok(quiet.every((info) => !('thinking' in info) && !('feedback' in info) && !('context' in info)), 'nothing private leaks by default');

  const captured: Record<string, unknown>[] = [];
  const capturingPlayer = new ModelPlayer<Move>({
    model: jsonModel(replies).model,
    name: 'test/captured',
    gameName: 'chess',
    speech: 'one sentence',
    contextProvider: () => 'Your private notebook: plan: develop fast.',
    onAttempt: (info) => captured.push({ ...info }),
    captureThinking: true,
  });
  const choice = await capturingPlayer.chooseAction(new ChessState());
  assert.equal(choice.rationale, 'Center pawn.');
  assert.equal(captured[0].thinking, 'The knight on b1 wants f3, but e4 first.');
  assert.equal(captured[0].feedback, undefined, 'the first attempt was shown no retry note');
  assert.match(String(captured[0].context), /Your private notebook: plan: develop fast\./);
  assert.equal(captured[1].thinking, 'Right, Qh5 is not legal from the start; e4 it is.');
  assert.match(String(captured[1].feedback), /"Qh5" was not a legal move here/);
});
