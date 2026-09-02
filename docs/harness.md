# Agentic game harness

`@vercel/arcade/harness` is the reusable boundary between a turn-based game and the
players controlling it. It is the same match seam used by the terminal app and the
headless match-lab.

The harness does four things:

1. asks the current `Player` for an action;
2. validates and normalizes model output through the rules state;
3. waits for the host's `playMove()` implementation to apply and settle the action; and
4. exposes lifecycle hooks for UI, traces, recording, and communication policy.

It deliberately does not log in to Vercel, select a billing team, publish telemetry, or
open a terminal. Applications own those policies.

## Run custom players

```ts
import { runMatch, type MatchScene, type Player } from '@vercel/arcade/harness';
import { ChessState, type Move } from '@vercel/arcade/rules/chess';

const state = new ChessState();
const scene: MatchScene<Move> = {
  state: () => state,
  playMove: async (move) => state.applyAction(move),
};

const firstLegal: Player<Move> = {
  name: 'first-legal',
  chooseAction: async (position) => ({ action: position.legalActions()[0] }),
};

await runMatch(scene, [firstLegal, firstLegal]);
```

`playMove()` may apply immediately in a batch evaluator or resolve only after a visible
animation completes in an interactive app. Because `runMatch()` awaits it, the model loop
cannot race ahead of the displayed state.

## Use a model player

```ts
import { gateway } from '@ai-sdk/gateway';
import { ModelPlayer } from '@vercel/arcade/harness';

const player = new ModelPlayer({
  name: 'claude',
  model: gateway('anthropic/claude-sonnet-4.5'),
  gameName: 'chess',
});
```

The caller configures the AI SDK provider and credentials. Arcade's device-login and team
picker are CLI product behavior, not a requirement of the harness.

Game-specific helpers are available from `@vercel/arcade/harness/chess`,
`@vercel/arcade/harness/islanders`, and `@vercel/arcade/harness/poker`. Public conversation
types, ambient/autoreply policy, and notable-moment helpers live at
`@vercel/arcade/harness/communication`.

## Run a headless Chess match

```ts
import { runHeadlessChessMatch } from '@vercel/arcade/harness/chess';
import { ChessState } from '@vercel/arcade/rules/chess';

const result = await runHeadlessChessMatch(
  new ChessState(),
  [whitePlayer, blackPlayer],
  { maxPlies: 300 },
);

console.log(result.status, result.plies, result.state.fen());
```

Live Arcade and match-lab share the same lower-level `runMatch` seam. Match-lab adds the
bounded `runChessMatch` evaluator wrapper; the live driver intentionally has no evaluator
ply cap. The default 300-ply limit is an evaluator safety bound, not a game rule. Islanders and
Poker expose result-based headless runners through their game-specific harness subpaths.

## Recording and telemetry

Use `onActionChosen`, `onActionApplied`, `onCommentary`, and game-session `onEvent` hooks to
write local traces or feed your own observability system. Canonical match, hand, participant,
action, and result contracts are available from `@vercel/arcade/harness/records`; the live
Arcade and match-lab use the same contracts. Arcade's telemetry delivery, durable outbox,
Node-specific record envelope, hashing, and hosted proxy remain product implementation
details rather than public package APIs.
