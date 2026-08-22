import assert from 'node:assert/strict';
import test from 'node:test';
import { CatanState } from '../../../rules/catan/catan.ts';
import { RESOURCES, resourceIndex, type CatanAction } from '../../../rules/catan/types.ts';
import { CatanGameScene } from './game-scene.ts';

test('the live human seam rolls and submits a staged bulk bank trade', async () => {
  const state = new CatanState({ numPlayers: 2, domesticTrade: true, rng: () => 0.5 });
  const scene = new CatanGameScene();
  scene.beginSession(state, ['red', 'blue'], 0);
  while (state.currentPrompt().kind === 'initialSettlement' || state.currentPrompt().kind === 'initialRoad') {
    await scene.playMove(state.legalActions()[0]);
  }

  let pending = scene.requestHumanMove();
  assert.equal(scene.submitHumanAction({ type: 'roll' }), true);
  assert.deepEqual(await pending, { type: 'roll' });
  await scene.playMove({ type: 'roll' });
  assert.equal(state.currentPrompt().kind, 'playTurn');

  const internals = state as unknown as { hands: number[][] };
  internals.hands[0].fill(0);
  internals.hands[0][resourceIndex('brick')] = 8;
  const gainsBefore = RESOURCES.reduce((sum, resource) => sum + scene.resourceViewAdjustments().handPending[resource], 0);
  pending = scene.requestHumanMove();
  assert.equal(scene.beginHumanMenu('bankTrade'), true);
  assert.equal(scene.pickHumanMaritimeGive('brick'), true);
  assert.equal(scene.pickHumanMenuResource('ore'), true);
  assert.equal(scene.pickHumanMenuResource('wool'), true);
  assert.equal(scene.humanMenuCanSubmit(), true);
  assert.equal(scene.submitHumanMenu(), true);

  const action = await pending;
  assert.deepEqual(action, {
    type: 'maritimeBulkTrade',
    via: 'bank',
    give: 'brick',
    gets: ['ore', 'wool'],
  } satisfies CatanAction);
  await scene.playMove(action);
  assert.equal(state.handOf(0)[resourceIndex('brick')], 0);
  assert.equal(state.handOf(0)[resourceIndex('ore')], 1);
  assert.equal(state.handOf(0)[resourceIndex('wool')], 1);
  assert.equal(RESOURCES.reduce((sum, resource) => sum + (scene.resourceViewAdjustments().handPendingDeparture?.[resource] ?? 0), 0), 8);
  assert.equal(RESOURCES.reduce((sum, resource) => sum + scene.resourceViewAdjustments().handPending[resource], 0), gainsBefore + 2);
});

test('a human responder opens the posted trade as a prefilled editable counteroffer', async () => {
  const state = new CatanState({ numPlayers: 2, domesticTrade: true, rng: () => 0.5 });
  const scene = new CatanGameScene();
  scene.beginSession(state, ['red', 'blue'], 1);
  while (state.currentPrompt().kind === 'initialSettlement' || state.currentPrompt().kind === 'initialRoad') {
    await scene.playMove(state.legalActions()[0]);
  }
  await scene.playMove({ type: 'roll' });
  const internals = state as unknown as { hands: number[][] };
  internals.hands[0].fill(0);
  internals.hands[1].fill(0);
  internals.hands[0][resourceIndex('brick')] = 2;
  internals.hands[1][resourceIndex('grain')] = 2;
  await scene.playMove({ type: 'offerTrade', give: [1, 0, 0, 0, 0], receive: [0, 1, 0, 0, 0] });

  const pending = scene.requestHumanMove();
  assert.equal(scene.beginHumanMenu('tradeCounter'), true);
  assert.deepEqual(scene.humanTradeDraft(), {
    give: [0, 1, 0, 0, 0],
    receive: [1, 0, 0, 0, 0],
  });
  assert.equal(scene.adjustHumanTradeResource('grain', 'give', 1), true);
  assert.equal(scene.adjustHumanTradeResource('brick', 'receive', 1), true);
  assert.equal(scene.adjustHumanTradeResource('grain', 'receive', 1), false, 'the same resource cannot appear on both sides');
  assert.equal(scene.humanMenuCanSubmit(), true);
  assert.equal(scene.submitHumanMenu(), true);
  assert.deepEqual(await pending, {
    type: 'counterTrade',
    give: [0, 2, 0, 0, 0],
    receive: [2, 0, 0, 0, 0],
  } satisfies CatanAction);
});
