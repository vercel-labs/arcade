import assert from 'node:assert/strict';
import test from 'node:test';
import { RenderTarget } from '../../../engine/index.ts';
import { COSTS, DEV_CARD_TYPES, RESOURCES, resourceIndex } from '../../../rules/islanders/types.ts';
import { IslandersDriver, type IslandersSeatSpec } from '../../match/islanders-driver.ts';
import { islandersDiscardDepartureCell, islandersHandLandingCell } from './card-hud.ts';
import { islandersLiveView } from './game-hud.ts';
import { IslandersGameScene } from './game-scene.ts';
import { TileScene } from './tile-scene.ts';
import { DICE_RESULT_REVEAL_DELAY, DICE_ROLL_DUR, DICE_STAGGER, type Die } from '../../../game-visuals/islanders/dice-choreography.ts';

const total = (counts: Record<(typeof RESOURCES)[number], number>): number =>
  RESOURCES.reduce((sum, resource) => sum + counts[resource], 0);

async function finishSetupWithProductionOnEight(game: IslandersGameScene, state: ReturnType<IslandersDriver['start']>): Promise<void> {
  while (state.currentPrompt().kind === 'initialSettlement' || state.currentPrompt().kind === 'initialRoad') {
    const action = state.currentPrompt().kind === 'initialSettlement' && state.currentPlayer() === 0
      ? (state.initialSettlementOptions().find((option) => option.adjacentHexes.some((hex) => hex.token === 8))?.action
        ?? state.legalActions()[0])
      : state.legalActions()[0];
    assert.ok(action);
    await game.playMove(action);
  }
}

test('live roll playback waits for dice landing and its visible production flights', async () => {
  const game = new IslandersGameScene();
  const driver = new IslandersDriver({ scene: game, syncLive: () => {} });
  const state = driver.start([
    { kind: 'ai', color: 'red', model: 'test/red' },
    { kind: 'ai', color: 'blue', model: 'test/blue' },
  ], { autoRun: false, rng: () => 0.5 });
  const region = { x: 0, y: 0, w: 100, h: 32 };
  game.setResourceFlightLayout(region, 2, false);
  await finishSetupWithProductionOnEight(game, state);
  const target = new RenderTarget(region.w, region.h * 2);
  game.renderScene(target, 0);
  game.renderScene(target, 5);
  assert.equal(game.activeResourceFlights().length, 0, 'setup grants are settled before testing the roll');
  game.setActionAnimationSynchronization(true);

  let resolved = false;
  const rolling = game.playMove({ type: 'roll' }).then(() => { resolved = true; });
  await Promise.resolve();
  assert.equal(resolved, false, 'the match loop must not outrun the dice');
  assert.equal(game.actionPreview()?.action.type, 'roll', 'the status remains on the roll while it animates');
  assert.ok(total(game.resourceViewAdjustments().handPending) > 0, 'production is withheld from the visible hand');

  game.renderScene(target, 5);
  game.renderScene(target, 5.5);
  await Promise.resolve();
  assert.equal(game.activeResourceFlights().length, 0, 'production waits for the dice to land');
  assert.equal(resolved, false);

  const liveDice = (game.scene as unknown as { dice: [Die, Die] }).dice;
  liveDice[0].dur = 1;
  liveDice[1].dur = 1;
  const physicalLanding = 5 + DICE_STAGGER + DICE_ROLL_DUR;
  game.renderScene(target, physicalLanding);
  assert.equal(game.activeResourceFlights().length, 0, 'the final-face settle beat still has no production flight');
  assert.equal(resolved, false, 'the game does not publish the roll on the physical landing frame');

  game.renderScene(target, physicalLanding + DICE_RESULT_REVEAL_DELAY);
  await Promise.resolve();
  game.renderScene(target, physicalLanding + DICE_RESULT_REVEAL_DELAY);
  assert.ok(game.activeResourceFlights().length > 0, 'production launches after the dice land');
  assert.equal(resolved, false, 'the next decision waits for the cards to reach the hand');

  for (let frame = 33; frame <= 48; frame++) game.renderScene(target, frame * 0.25);
  await rolling;
  assert.equal(resolved, true);
  assert.equal(game.actionPreview(), null);
  assert.equal(total(game.resourceViewAdjustments().handPending), 0);
});

test('headless roll playback stays immediate when render synchronization is disabled', async () => {
  const game = new IslandersGameScene();
  const driver = new IslandersDriver({ scene: game, syncLive: () => {} });
  const state = driver.start([
    { kind: 'ai', color: 'red', model: 'test/red' },
    { kind: 'ai', color: 'blue', model: 'test/blue' },
  ], { autoRun: false, rng: () => 0.5 });
  await finishSetupWithProductionOnEight(game, state);
  await game.playMove({ type: 'roll' });
});

test('dice visibly settle before publishing highlights, payouts, or seven handling', () => {
  const scene = new TileScene();
  scene.setMode('board');
  scene.settle();
  const landed: number[] = [];
  scene.onRollLanded = (sum) => landed.push(sum);
  void scene.rollDice([4, 5]);
  const dice = (scene as unknown as { dice: [Die, Die] }).dice;
  dice[0].dur = 1;
  dice[1].dur = 1;
  const target = new RenderTarget(100, 64);
  const physicalLanding = DICE_STAGGER + DICE_ROLL_DUR;

  scene.renderScene(target, 0);
  scene.renderScene(target, physicalLanding);
  assert.deepEqual(landed, [], 'no result-dependent callback fires on the physical landing frame');
  assert.equal((scene as unknown as { dicePhase: string }).dicePhase, 'hold', 'the final dice remain visibly at rest');
  assert.equal((scene as unknown as { rolledSum: number | null }).rolledSum, null, 'matching number tokens stay unlit');
  void scene.rollDice([1, 1]);
  assert.equal((scene as unknown as { dice: [Die, Die] }).dice[0].val, 4, 'a second roll cannot replace an unpublished result');

  scene.renderScene(target, physicalLanding + DICE_RESULT_REVEAL_DELAY - 0.001);
  assert.deepEqual(landed, []);
  assert.equal((scene as unknown as { rolledSum: number | null }).rolledSum, null);

  scene.renderScene(target, physicalLanding + DICE_RESULT_REVEAL_DELAY);
  assert.deepEqual(landed, [9]);
  assert.equal((scene as unknown as { rolledSum: number | null }).rolledSum, 9);
});

test('a confirmed human discard closes its panel and flies the staged cards to the bank', async () => {
  const game = new IslandersGameScene();
  const driver = new IslandersDriver({ scene: game, syncLive: () => {} });
  const state = driver.start([
    { kind: 'human', color: 'red' },
    { kind: 'ai', color: 'blue', model: 'test/blue' },
  ], { autoRun: false, rng: () => 0.5 });
  const region = { x: 0, y: 0, w: 140, h: 50 };
  game.setResourceFlightLayout(region, 2, true);
  await finishSetupWithProductionOnEight(game, state);
  const target = new RenderTarget(region.w, region.h * 2);
  game.renderScene(target, 0);
  game.renderScene(target, 5);
  assert.equal(game.activeResourceFlights().length, 0, 'initial-placement grants are settled before the discard');

  const hands = (state as unknown as { hands: number[][] }).hands;
  hands[0].fill(0);
  hands[0][resourceIndex('brick')] = 5;
  hands[0][resourceIndex('grain')] = 4;
  state.applyAction({ type: 'roll' }, { dice: [3, 4] });

  const pending = game.requestHumanMove();
  assert.equal(game.humanMenuKind(), 'discard');
  for (let count = 0; count < 3; count++) assert.equal(game.pickHumanMenuResource('brick'), true);
  assert.equal(game.pickHumanMenuResource('grain'), true);
  assert.equal(game.submitHumanMenu(), true);
  assert.equal(game.humanMenuKind(), null, 'confirming closes the discard panel before playback');

  const action = await pending;
  assert.deepEqual(action, { type: 'discard', resources: ['brick', 'brick', 'brick', 'grain'] });
  void game.playMove(action);
  assert.equal(total(game.resourceViewAdjustments().handPendingDeparture ?? {} as Record<(typeof RESOURCES)[number], number>), 4);

  game.renderScene(target, 5);
  const active = game.activeResourceFlights();
  const brick = active.find((flight) => flight.resource === 'brick');
  assert.ok(brick);
  assert.deepEqual(
    { col: brick.col, row: brick.row },
    islandersDiscardDepartureCell(region, 'brick'),
    'the first discarded card leaves its staged slot',
  );
  assert.notDeepEqual(
    { col: brick.col, row: brick.row },
    islandersHandLandingCell(region, 'brick'),
    'the discard does not launch from the normal hand row',
  );
  const waitingToDepart = total(game.resourceViewAdjustments().handPendingDeparture
    ?? {} as Record<(typeof RESOURCES)[number], number>);
  assert.ok(waitingToDepart > 0 && waitingToDepart < 4, 'the stagger removes cards as each one leaves the panel');

  for (let frame = 21; frame <= 40; frame++) game.renderScene(target, frame * 0.25);
  assert.equal(game.activeResourceFlights().length, 0);
  assert.equal(total(game.resourceViewAdjustments().handPendingDeparture ?? {} as Record<(typeof RESOURCES)[number], number>), 0);
  assert.equal(total(game.resourceViewAdjustments().bankPendingArrival ?? {} as Record<(typeof RESOURCES)[number], number>), 0);
});

test('the next legal roll can replace the previous dice hold', async () => {
  const scene = new TileScene();
  scene.setMode('boardCards');
  const landed: number[] = [];
  scene.onRollLanded = (sum) => landed.push(sum);
  const target = new RenderTarget(100, 64);

  const first = scene.rollDice([1, 1]);
  scene.renderScene(target, 0);
  scene.renderScene(target, 3);
  await first;
  assert.deepEqual(landed, [2]);

  const second = scene.rollDice([6, 6]);
  scene.renderScene(target, 3);
  scene.renderScene(target, 6);
  await second;
  assert.deepEqual(landed, [2, 12]);
});

test('live placement playback waits for the piece to settle', async () => {
  const game = new IslandersGameScene();
  const driver = new IslandersDriver({ scene: game, syncLive: () => {} });
  const state = driver.start([
    { kind: 'ai', color: 'red', model: 'test/red' },
    { kind: 'ai', color: 'blue', model: 'test/blue' },
  ], { autoRun: false, rng: () => 0.5 });
  game.setActionAnimationSynchronization(true);

  let resolved = false;
  const placing = game.playMove(state.legalActions()[0]).then(() => { resolved = true; });
  await Promise.resolve();
  assert.equal(resolved, false);

  const target = new RenderTarget(100, 64);
  game.renderScene(target, 0);
  game.renderScene(target, 0.2);
  await Promise.resolve();
  assert.equal(resolved, false);
  game.renderScene(target, 0.6);
  await placing;
});

test('ending a session releases a synchronized roll without a render frame', async () => {
  const game = new IslandersGameScene();
  const driver = new IslandersDriver({ scene: game, syncLive: () => {} });
  const state = driver.start([
    { kind: 'ai', color: 'red', model: 'test/red' },
    { kind: 'ai', color: 'blue', model: 'test/blue' },
  ], { autoRun: false, rng: () => 0.5 });
  await finishSetupWithProductionOnEight(game, state);
  game.setActionAnimationSynchronization(true);

  const rolling = game.playMove({ type: 'roll' });
  driver.reset();
  await rolling;
  assert.equal(game.hasSession(), false);
});

test('development purchases remain non-blocking while their card and payment animate', async () => {
  const game = new IslandersGameScene();
  const driver = new IslandersDriver({ scene: game, syncLive: () => {} });
  const state = driver.start([
    { kind: 'human', color: 'red' },
    { kind: 'ai', color: 'blue', model: 'test/blue' },
  ], { autoRun: false, rng: () => 0.5 });
  game.setResourceFlightLayout({ x: 0, y: 0, w: 100, h: 32 }, 2, false);
  await finishSetupWithProductionOnEight(game, state);
  await game.playMove({ type: 'roll' });
  const internals = state as unknown as { hands: number[][] };
  for (let index = 0; index < COSTS.devCard.length; index++) internals.hands[0][index] += COSTS.devCard[index];
  game.setActionAnimationSynchronization(true);

  let resolved = false;
  const buying = game.playMove({ type: 'buyDevCard' }).then(() => { resolved = true; });
  await Promise.resolve();
  assert.equal(resolved, true, 'the next trade or dev purchase can start before this card lands');
  await buying;
});

test('the visible second-settlement grant flies in from the right before reaching the hand', async () => {
  const game = new IslandersGameScene();
  const driver = new IslandersDriver({ scene: game, syncLive: () => {} });
  const seats: IslandersSeatSpec[] = [
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
  assert.equal(total(islandersLiveView(state, driver, game.resourceViewAdjustments()).hand), before);

  // The rules state has paid already, but the first presented frame launches a visible card from
  // beyond the terminal edge and the HUD projection withholds it until landing.
  const target = new RenderTarget(region.w, region.h * 2);
  game.renderScene(target, 0);
  assert.ok(game.activeResourceFlights().some((flight) => flight.col > region.w));

  for (let frame = 1; frame <= 16; frame++) game.renderScene(target, frame * 0.25);
  assert.equal(game.activeResourceFlights().length, 0);
  assert.equal(total(game.resourceViewAdjustments().handPending), 0);
  assert.equal(total(game.resourceViewAdjustments().bankPendingDeparture), 0);
  assert.equal(total(islandersLiveView(state, driver, game.resourceViewAdjustments()).hand), after);
});

test('a bought development card stays in flight until it lands in the live hand', async () => {
  const game = new IslandersGameScene();
  const driver = new IslandersDriver({ scene: game, syncLive: () => {} });
  const seats: IslandersSeatSpec[] = [
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
  let view = islandersLiveView(state, driver, pending);
  assert.equal(DEV_CARD_TYPES.reduce((sum, card) => sum + view.devHand[card], 0), 0);
  assert.equal(view.developmentDeck, deckBefore);

  const target = new RenderTarget(region.w, region.h * 2);
  game.renderScene(target, 0);
  assert.ok(game.activeResourceFlights().some((flight) => flight.resource === type && flight.col > region.w));
  for (let frame = 1; frame <= 16; frame++) game.renderScene(target, frame * 0.25);

  view = islandersLiveView(state, driver, game.resourceViewAdjustments());
  assert.equal(game.activeResourceFlights().length, 0);
  assert.equal(view.devHand[type], 1);
  assert.equal(view.developmentDeck, deckBefore - 1);
});
