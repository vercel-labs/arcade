import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MockLanguageModelV3 } from 'ai/test';
import type { GameState } from '../../rules/game.ts';
import { CatanState } from '../../rules/catan/catan.ts';
import type { CatanAction } from '../../rules/catan/types.ts';
import type { Player } from '../../ai/player.ts';
import {
  type CatanSetupScene,
  CatanMatchActionLimitError,
  createCatanModelPlayer,
  runCatanMatch,
  createCatanSetupModelPlayer,
  runCatanInitialPlacement,
} from './catan-setup.ts';

function rng(seed = 0xc47a): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

class SetupScene implements CatanSetupScene {
  readonly actions: CatanAction[] = [];

  constructor(private readonly game: CatanState) {}

  state(): CatanState {
    return this.game;
  }

  async playMove(action: CatanAction): Promise<void> {
    this.actions.push(action);
    this.game.applyAction(action);
  }
}

class GreedySetupPlayer implements Player<CatanAction> {
  calls = 0;

  constructor(readonly name: string) {}

  async chooseAction(state: GameState<CatanAction>): Promise<{ action: CatanAction; rationale: string }> {
    this.calls++;
    const catan = state as CatanState;
    if (catan.currentPrompt().kind === 'initialSettlement') {
      const option = catan
        .initialSettlementOptions()
        .reduce((best, candidate) =>
          candidate.totalPips + candidate.resourceDiversity > best.totalPips + best.resourceDiversity ? candidate : best,
        );
      return { action: option.action, rationale: `N${option.node}: ${option.totalPips} pips` };
    }
    const score = (option: ReturnType<CatanState['initialRoadOptions']>[number]): number =>
      Math.max(0, ...option.expansionSites.map((site) => site.totalPips));
    const option = catan.initialRoadOptions().reduce((best, candidate) => (score(candidate) > score(best) ? candidate : best));
    return { action: option.action, rationale: `E${option.edge}: expands toward N${option.towardNode}` };
  }
}

test('setup runner drives four players through exactly the initial snake and stops before roll', async () => {
  const state = new CatanState({ numPlayers: 4, rng: rng(), seatNames: ['A', 'B', 'C', 'D'] });
  const scene = new SetupScene(state);
  const players = ['A', 'B', 'C', 'D'].map((name) => new GreedySetupPlayer(name));
  const thinking: number[] = [];
  const commentary: string[] = [];

  const result = await runCatanInitialPlacement(scene, players, {
    onThinking: (_player, seat) => thinking.push(seat),
    onCommentary: (text) => commentary.push(text),
  });

  assert.equal(result, state);
  assert.equal(state.initialPlacementComplete(), true);
  assert.equal(state.currentPrompt().kind, 'roll');
  assert.equal(scene.actions.length, 16);
  assert.deepEqual(players.map((player) => player.calls), [4, 4, 4, 4]);
  assert.deepEqual(
    thinking.filter((_, index) => scene.actions[index].type === 'initialSettlement'),
    [0, 1, 2, 3, 3, 2, 1, 0],
  );
  assert.equal(commentary.length, 16);
});

test('setup runner requires exactly one player per Catan seat', async () => {
  const scene = new SetupScene(new CatanState({ numPlayers: 4, rng: rng() }));
  await assert.rejects(() => runCatanInitialPlacement(scene, [new GreedySetupPlayer('only one')]), /one player per seat/);
});

test('full match runner uses the same scene seam beyond setup with no UI dependency', async () => {
  const state = new CatanState({ numPlayers: 4, rng: rng() });
  const scene = new SetupScene(state);
  const players: Player<CatanAction>[] = Array.from({ length: 4 }, (_, seat) => ({
    name: `P${seat}`,
    chooseAction: async (game) => ({ action: game.legalActions()[0], rationale: 'first legal action' }),
  }));
  const result = await runCatanMatch(scene, players, {
    shouldStop: () => state.initialPlacementComplete() && state.currentPlayer() === 1,
  });
  assert.equal(result, state);
  assert.ok(scene.actions.length >= 18, '16 setup actions, then at least roll and end turn');
  assert.equal(scene.actions[16].type, 'roll');
  assert.equal(scene.actions.at(-1)?.type, 'endTurn');
  assert.deepEqual(state.currentPrompt(), { kind: 'roll', player: 1 });
});

test('full match runner stops a legal but non-progressing evaluation at its action limit', async () => {
  const state = new CatanState({ numPlayers: 4, rng: rng() });
  const scene = new SetupScene(state);
  const players: Player<CatanAction>[] = Array.from({ length: 4 }, (_, seat) => ({
    name: `P${seat}`,
    chooseAction: async (game) => ({ action: game.legalActions()[0], rationale: 'first legal action' }),
  }));
  await assert.rejects(
    () => runCatanMatch(scene, players, { maxActions: 20 }),
    (error) => error instanceof CatanMatchActionLimitError && error.maxActions === 20,
  );
  assert.equal(scene.actions.length, 20);
  assert.equal(state.isTerminal(), false);
});

test('the generic ModelPlayer can select a typed legal Catan setup action', async () => {
  const state = new CatanState({ numPlayers: 4, rng: rng() });
  const choice = state.initialSettlementOptions().reduce((best, option) => (option.totalPips > best.totalPips ? option : best));
  let request = '';
  const model = new MockLanguageModelV3({
    doGenerate: async (options) => {
      request = JSON.stringify(options.prompt);
      return ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({ move: `init-settlement ${choice.node}`, rationale: 'Strong production and useful diversity.' }),
          },
        ],
        finishReason: { unified: 'stop', raw: undefined },
        usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
        warnings: [],
      }) as unknown as Awaited<ReturnType<MockLanguageModelV3['doGenerate']>>;
    },
  });
  const player = createCatanSetupModelPlayer({
    model,
    name: 'catan-model',
  });

  const picked = await player.chooseAction(state);
  assert.match(request, /Legal actions/);
  assert.match(request, new RegExp(`init-settlement ${choice.node}:`));
  assert.match(request, /Facts are descriptive, not recommendations/);
  assert.deepEqual(picked.action, choice.action);
  state.applyAction(picked.action);
  assert.equal(state.currentPrompt().kind, 'initialRoad');
});

test('Catan setup model fallback is deterministic unless a seeded RNG is supplied', async () => {
  const stateA = new CatanState({ numPlayers: 4, rng: rng(123) });
  const stateB = new CatanState({ numPlayers: 4, rng: rng(123) });
  const invalidModel = () =>
    new MockLanguageModelV3({
      doGenerate: async () =>
        ({
          content: [{ type: 'text', text: JSON.stringify({ move: 'not-a-node', rationale: 'No valid choice.' }) }],
          finishReason: { unified: 'stop', raw: undefined },
          usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
          warnings: [],
        }) as unknown as Awaited<ReturnType<MockLanguageModelV3['doGenerate']>>,
    });
  const choiceA = await createCatanSetupModelPlayer({ model: invalidModel(), maxRetries: 0 }).chooseAction(stateA);
  const choiceB = await createCatanSetupModelPlayer({ model: invalidModel(), maxRetries: 0 }).chooseAction(stateB);
  assert.deepEqual(choiceA.action, stateA.legalActions()[0]);
  assert.deepEqual(choiceB.action, choiceA.action);
  assert.equal(choiceA.diagnostics?.resolution, 'random-fallback');
});

test('full-game ModelPlayer fallback can discover a parameterized domestic-trade example', async () => {
  const state = new CatanState({ numPlayers: 4, rng: rng(), domesticTrade: true });
  while (!state.initialPlacementComplete()) state.applyAction(state.legalActions()[0]);
  state.applyAction({ type: 'roll' }, { dice: [1, 1] });
  const model = new MockLanguageModelV3({
    doGenerate: async () =>
      ({
        content: [{ type: 'text', text: JSON.stringify({ move: 'invalid', rationale: 'No valid choice.' }) }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
        warnings: [],
      }) as unknown as Awaited<ReturnType<MockLanguageModelV3['doGenerate']>>,
  });
  const player = createCatanModelPlayer({ model, maxRetries: 0, fallbackRng: () => 0.999 });
  const choice = await player.chooseAction(state);
  assert.equal(choice.action.type, 'offerTrade');
  assert.equal(state.isLegalAction(choice.action), true);
});

test('the full-game model harness exposes and parses responder counteroffers', async () => {
  const state = new CatanState({ numPlayers: 2, rng: rng(), domesticTrade: true });
  while (!state.initialPlacementComplete()) state.applyAction(state.legalActions()[0]);
  state.applyAction({ type: 'roll' }, { dice: [1, 1] });
  const hands = (state as unknown as { hands: number[][] }).hands;
  hands[0] = [2, 0, 0, 0, 0];
  hands[1] = [0, 2, 0, 0, 0];
  state.applyAction({ type: 'offerTrade', give: [1, 0, 0, 0, 0], receive: [0, 1, 0, 0, 0] });
  let request = '';
  const model = new MockLanguageModelV3({
    doGenerate: async (options) => {
      request = JSON.stringify(options.prompt);
      return ({
        content: [{ type: 'text', text: JSON.stringify({ move: 'counter 0/2/0/0/0 for 1/0/0/0/0', rationale: 'I want two grain for the brick.' }) }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
        warnings: [],
      }) as unknown as Awaited<ReturnType<MockLanguageModelV3['doGenerate']>>;
    },
  });
  const choice = await createCatanModelPlayer({ model, name: 'counter-model' }).chooseAction(state);
  assert.match(request, /Counteroffer \(parameterized\)/);
  assert.match(request, /counter 0\/1\/0\/0\/0 for 1\/0\/0\/0\/0/);
  assert.deepEqual(choice.action, { type: 'counterTrade', give: [0, 2, 0, 0, 0], receive: [1, 0, 0, 0, 0] });
});
