import assert from 'node:assert/strict';
import test from 'node:test';
import { RenderTarget } from '../../../engine/index.ts';
import { COSTS, DEV_CARD_TYPES, RESOURCES, resourceIndex } from '../../../rules/catan/types.ts';
import { CatanDriver, type CatanSeatSpec } from '../../match/catan-driver.ts';
import { catanLiveView } from './game-hud.ts';
import { CatanGameScene } from './game-scene.ts';

const total = (counts: Record<(typeof RESOURCES)[number], number>): number =>
  RESOURCES.reduce((sum, resource) => sum + counts[resource], 0);

test('the visible second-settlement grant flies in from the right before reaching the hand', async () => {
  const game = new CatanGameScene();
  const driver = new CatanDriver({ scene: game, syncLive: () => {} });
  const seats: CatanSeatSpec[] = [
    { kind: 'human', color: 'red' },
    { kind: 'ai', color: 'blue', model: 'test/blue' },
    { kind: 'ai', color: 'purple', model: 'test/purple' },
    { kind: 'ai', color: 'orange', model: 'test/orange' },
  ];
  const state = driver.start(seats, { autoRun: false, rng: () => 0.5 });
  const region = { x: 0, y: 0, w: 100, h: 32 };
  game.setResourceFlightLayout(region, 4, false);

  // Walk the snake to seat 0's second settlement, where the setup grant is paid.
  while (!(state.currentPrompt().kind === 'initialSettlement'
    && state.currentPlayer() === 0
    && state.initialSettlementCount(0) === 1)) {
    const action = state.legalActions()[0];
    assert.ok(action);
    await game.playMove(action);
  }
  const before = RESOURCES.reduce((sum, resource) => sum + state.handOf(0)[resourceIndex(resource)], 0);
  const settlement = state.initialSettlementOptions().find((option) => option.portfolio.startingResources.length > 0)?.action;
  assert.ok(settlement);
  await game.playMove(settlement);

  const after = RESOURCES.reduce((sum, resource) => sum + state.handOf(0)[resourceIndex(resource)], 0);
  const granted = after - before;
  assert.ok(granted > 0);
  assert.equal(total(game.resourceViewAdjustments().handPending), granted);
  assert.equal(total(game.resourceViewAdjustments().bankPendingDeparture), granted);
  assert.equal(total(catanLiveView(state, driver, game.resourceViewAdjustments()).hand), before);

  // The rules state has paid already, but the first presented frame launches a visible card from
  // beyond the terminal edge and the HUD projection withholds it until landing.
  const target = new RenderTarget(region.w, region.h * 2);
  game.renderScene(target, 0);
  assert.ok(game.activeResourceFlights().some((flight) => flight.col > region.w));

  for (let frame = 1; frame <= 16; frame++) game.renderScene(target, frame * 0.25);
  assert.equal(game.activeResourceFlights().length, 0);
  assert.equal(total(game.resourceViewAdjustments().handPending), 0);
  assert.equal(total(game.resourceViewAdjustments().bankPendingDeparture), 0);
  assert.equal(total(catanLiveView(state, driver, game.resourceViewAdjustments()).hand), after);
});

test('a bought development card stays in flight until it lands in the live hand', async () => {
  const game = new CatanGameScene();
  const driver = new CatanDriver({ scene: game, syncLive: () => {} });
  const seats: CatanSeatSpec[] = [
    { kind: 'human', color: 'red' },
    { kind: 'ai', color: 'blue', model: 'test/blue' },
    { kind: 'ai', color: 'purple', model: 'test/purple' },
    { kind: 'ai', color: 'orange', model: 'test/orange' },
  ];
  const state = driver.start(seats, { autoRun: false, rng: () => 0.5 });
  const region = { x: 0, y: 0, w: 100, h: 32 };
  game.setResourceFlightLayout(region, 4, false);
  while (state.currentPrompt().kind === 'initialSettlement' || state.currentPrompt().kind === 'initialRoad') {
    await game.playMove(state.legalActions()[0]);
  }
  await game.playMove({ type: 'roll' });

  const internals = state as unknown as { hands: number[][] };
  for (let index = 0; index < COSTS.devCard.length; index++) internals.hands[0][index] += COSTS.devCard[index];
  const deckBefore = state.developmentDeckSize();
  await game.playMove({ type: 'buyDevCard' });

  const pending = game.resourceViewAdjustments();
  const type = pending.pendingDevelopmentCards?.[0];
  assert.ok(type);
  assert.equal(pending.developmentHandPending?.[type], 1);
  let view = catanLiveView(state, driver, pending);
  assert.equal(DEV_CARD_TYPES.reduce((sum, card) => sum + view.devHand[card], 0), 0);
  assert.equal(view.developmentDeck, deckBefore);

  const target = new RenderTarget(region.w, region.h * 2);
  game.renderScene(target, 0);
  assert.ok(game.activeResourceFlights().some((flight) => flight.resource === type && flight.col > region.w));
  for (let frame = 1; frame <= 16; frame++) game.renderScene(target, frame * 0.25);

  view = catanLiveView(state, driver, game.resourceViewAdjustments());
  assert.equal(game.activeResourceFlights().length, 0);
  assert.equal(view.devHand[type], 1);
  assert.equal(view.developmentDeck, deckBefore - 1);
});
