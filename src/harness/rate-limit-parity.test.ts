// Every game has to react to a Gateway failure the same way. The notice is built in
// shared code, but each game constructs its own ModelPlayer, so nothing stops one from
// drifting: dropping onFailureNotice, or swallowing the throw and playing a random legal
// action while the seat quietly stops thinking. That difference is invisible in the UI
// until a match silently degrades, so assert the parity directly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockLanguageModelV3 } from 'ai/test';
import { mulberry32 } from '../engine/index.ts';
import { createChessModelPlayer } from './games/chess/index.ts';
import { createIslandersModelPlayer } from './games/islanders/index.ts';
import { createPokerTextPlayer } from './games/poker/index.ts';
import { ChessState } from '../rules/chess/chess.ts';
import { IslandersState } from '../rules/islanders/index.ts';
import { HoldemState } from '../rules/poker/holdem.ts';
import type { ModelFailureNotice } from './model-failure-notice.ts';

// The shape a free-tier rate limit actually arrives in: the SDK retries the 429, gives
// up, and reports a RetryError whose `.cause` is null, with the real error on
// `.lastError`. See model-errors.test.ts.
function rateLimitError(): unknown {
  const message =
    'Free tier requests on this model are rate-limited. Upgrade to paid credits at ' +
    'https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%3Fmodal%3Dtop-up for unrestricted access.';
  const inner = Object.assign(new Error(message), {
    name: 'GatewayRateLimitError',
    type: 'rate_limit_exceeded',
    statusCode: 429,
    cause: Object.assign(new Error(message), { name: 'AI_APICallError', statusCode: 429 }),
  });
  return Object.assign(new Error(`Failed after 3 attempts. Last error: ${message}`), {
    name: 'AI_RetryError',
    reason: 'maxRetriesExceeded',
    cause: null,
    lastError: inner,
    errors: [inner, inner, inner],
  });
}

const rateLimitedModel = (): MockLanguageModelV3 =>
  new MockLanguageModelV3({ doGenerate: async () => { throw rateLimitError(); } });

type Notify = (notice: ModelFailureNotice) => void;

// Each game keeps its own concrete action type, so the attempt is a closure per game
// rather than one generic call.
const GAMES: { game: string; attempt: (notify: Notify) => Promise<unknown> }[] = [
  {
    game: 'chess',
    attempt: (onFailureNotice) =>
      createChessModelPlayer({ model: rateLimitedModel(), name: 'white', onFailureNotice })
        .chooseAction(new ChessState(), {}),
  },
  {
    game: 'poker',
    attempt: (onFailureNotice) =>
      createPokerTextPlayer({ model: rateLimitedModel(), name: 'seat 1', onFailureNotice })
        .chooseAction(
          new HoldemState({ stacks: [100, 100], button: 0, smallBlind: 1, bigBlind: 2, rng: mulberry32(7) }),
          {},
        ),
  },
  {
    game: 'islanders',
    attempt: (onFailureNotice) =>
      createIslandersModelPlayer({ model: rateLimitedModel(), name: 'red', onFailureNotice })
        .chooseAction(new IslandersState({ numPlayers: 3, rng: mulberry32(7) }), {}),
  },
];

for (const { game, attempt } of GAMES) {
  test(`${game}: a Gateway rate limit pauses the match instead of playing a random action`, async () => {
    const notices: ModelFailureNotice[] = [];

    // Throwing is what makes the driver pause and offer a retry. Returning an action
    // here would mean the seat silently played a random legal move on a 429.
    await assert.rejects(() => attempt((n) => notices.push(n)), { name: 'NotifiedModelFailure' });

    assert.equal(notices.length, 1, 'exactly one notice reaches the driver');
    const [notice] = notices;
    assert.equal(notice.code, 'rate_limit_exceeded');
    assert.equal(notice.severity, 'caution');
    assert.equal(notice.persistent, true);
    assert.match(notice.body, /free-tier/);
    assert.match(notice.action?.url ?? '', /ai-gateway%2Flogs/);
  });
}
