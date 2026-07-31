import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MockLanguageModelV3 } from 'ai/test';
import type { GameState } from '../../rules/game.ts';
import { CatanState } from '../../rules/catan/catan.ts';
import type { CatanAction } from '../../rules/catan/types.ts';
import type { Player } from '../../ai/player.ts';
import {
  type CatanSetupScene,
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

test('the generic ModelPlayer can select a typed legal Catan setup action', async () => {
  const state = new CatanState({ numPlayers: 4, rng: rng() });
  const choice = state.initialSettlementOptions().reduce((best, option) => (option.totalPips > best.totalPips ? option : best));
  const model = new MockLanguageModelV3({
    doGenerate: async () =>
      ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({ move: `init-settlement ${choice.node}`, rationale: 'Strong production and useful diversity.' }),
          },
        ],
        finishReason: { unified: 'stop', raw: undefined },
        usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
        warnings: [],
      }) as unknown as Awaited<ReturnType<MockLanguageModelV3['doGenerate']>>,
  });
  const player = createCatanSetupModelPlayer({
    model,
    name: 'catan-model',
  });

  const picked = await player.chooseAction(state);
  assert.deepEqual(picked.action, choice.action);
  state.applyAction(picked.action);
  assert.equal(state.currentPrompt().kind, 'initialRoad');
});
