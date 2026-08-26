import assert from 'node:assert/strict';
import test from 'node:test';
import { CatanState } from '../../../rules/catan/catan.ts';
import { DEV_CARD_TYPES, RESOURCES, resourceIndex, type CatanAction } from '../../../rules/catan/types.ts';
import type { Node } from '../../../tui/index.ts';
import { CatanDriver, type CatanSeatSpec } from '../../match/catan-driver.ts';
import { buildCatanGameRoot, catanLiveView, catanStatusLine } from './game-hud.ts';
import { catanSidebarPlayers } from './card-hud.ts';
import { CatanGameScene, catanActionPlaybackFrames } from './game-scene.ts';

function findNode(node: Node, id: string): Node | undefined {
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return undefined;
}

test('the live hand owns the shared trade and buy-dev cards while new game stays in the menu', async () => {
  const scene = new CatanGameScene();
  const driver = new CatanDriver({ scene, syncLive: () => {} });
  const seats: CatanSeatSpec[] = [
    { kind: 'human', color: 'red' },
    { kind: 'ai', color: 'blue', model: 'test/blue' },
  ];
  const state = driver.start(seats, { autoRun: false, rng: () => 0.5 });
  while (state.currentPrompt().kind === 'initialSettlement' || state.currentPrompt().kind === 'initialRoad') {
    await scene.playMove(state.legalActions()[0]);
  }
  await scene.playMove({ type: 'roll' });
  const hands = (state as unknown as { hands: number[][] }).hands;
  for (const resource of ['wool', 'grain', 'ore'] as const) hands[0][resourceIndex(resource)] += 2;
  hands[0][resourceIndex('brick')] += 4;

  const pending = scene.requestHumanMove();
  const root = buildCatanGameRoot({ x: 0, y: 0, w: 140, h: 50 }, {
    driver,
    scene,
    onOpenMenu: () => {},
    onStart: () => {},
  });

  assert.equal(findNode(root, 'catan-trade-open')?.disabled, false);
  assert.equal(findNode(root, 'catan-buy-dev')?.disabled, false);
  assert.ok(findNode(root, 'catan-live-end'));
  assert.equal(findNode(root, 'catan-live-trade'), undefined);
  assert.equal(findNode(root, 'catan-live-buy-dev'), undefined);
  assert.equal(findNode(root, 'catan-new-game'), undefined);

  assert.equal(scene.submitHumanAction({ type: 'endTurn' }), true);
  await pending;
});

test('spectators can click a player to inspect that seat hand and development cards', () => {
  const scene = new CatanGameScene();
  const driver = new CatanDriver({ scene, syncLive: () => {} });
  const state = driver.start([
    { kind: 'ai', color: 'red', model: 'test/red' },
    { kind: 'ai', color: 'blue', model: 'test/blue' },
  ], { autoRun: false, rng: () => 0.5 });
  const internals = state as unknown as { hands: number[][]; devHand: number[][] };
  internals.hands[0].fill(0);
  internals.hands[1].fill(0);
  internals.hands[1][resourceIndex('ore')] = 3;
  internals.devHand[1][DEV_CARD_TYPES.indexOf('knight')] = 2;

  let root = buildCatanGameRoot({ x: 0, y: 0, w: 140, h: 50 }, {
    driver,
    scene,
    onOpenMenu: () => {},
    onStart: () => {},
  });
  const blue = findNode(root, 'catan-view-seat-1');
  assert.equal(blue?.disabled, false);
  blue?.onClick?.();
  assert.equal(scene.viewedSeat(), 1);

  root = buildCatanGameRoot({ x: 0, y: 0, w: 140, h: 50 }, {
    driver,
    scene,
    onOpenMenu: () => {},
    onStart: () => {},
  });
  assert.equal(findNode(root, 'catan-view-seat-1')?.text?.startsWith('▸'), true);
  const view = catanLiveView(state, driver, undefined, 1);
  assert.equal(view.hand.ore, 3);
  assert.equal(view.devHand.knight, 2);
  assert.deepEqual(catanSidebarPlayers(view).map((player) => player.seat), [0, 1]);
});

test('spectator POV changes never reorder the sidebar player rows', () => {
  const scene = new CatanGameScene();
  const driver = new CatanDriver({ scene, syncLive: () => {} });
  const state = driver.start([
    { kind: 'ai', color: 'red', model: 'test/red' },
    { kind: 'ai', color: 'blue', model: 'test/blue' },
    { kind: 'ai', color: 'orange', model: 'test/orange' },
    { kind: 'ai', color: 'purple', model: 'test/purple' },
  ], { autoRun: false, rng: () => 0.5 });

  for (const viewer of [0, 2, 3, 1]) {
    const view = catanLiveView(state, driver, undefined, viewer);
    assert.equal(view.localPlayer.seat, viewer);
    assert.deepEqual(catanSidebarPlayers(view).map((player) => player.seat), [0, 1, 2, 3]);
  }
});

test('an AI trade visibly stages in the shared editor before becoming a posted trade popup', async () => {
  const scene = new CatanGameScene();
  scene.setActionPreviewDuration(5);
  const driver = new CatanDriver({ scene, syncLive: () => {} });
  const state = driver.start([
    { kind: 'ai', color: 'red', model: 'test/red' },
    { kind: 'ai', color: 'blue', model: 'test/blue' },
  ], { autoRun: false, rng: () => 0.5 });
  while (state.currentPrompt().kind === 'initialSettlement' || state.currentPrompt().kind === 'initialRoad') {
    await scene.playMove(state.legalActions()[0]);
  }
  await scene.playMove({ type: 'roll' });
  const internals = state as unknown as { hands: number[][] };
  internals.hands[0].fill(0);
  internals.hands[1].fill(0);
  internals.hands[0][resourceIndex('brick')] = 2;
  internals.hands[1][resourceIndex('grain')] = 2;
  const offer: CatanAction = { type: 'offerTrade', give: [1, 0, 0, 0, 0], receive: [0, 1, 0, 0, 0] };
  scene.setViewedSeat(1);

  const applying = scene.playMove(offer);
  assert.deepEqual(scene.actionPreview(), {
    seat: 0,
    action: offer,
    phase: 'opening',
    trade: { mode: 'standard', give: [0, 0, 0, 0, 0], receive: [0, 0, 0, 0, 0] },
  });
  assert.match(catanStatusLine(driver, scene.actionPreview())?.text ?? '', /opening the trade panel/);
  let root = buildCatanGameRoot({ x: 0, y: 0, w: 140, h: 50 }, {
    driver,
    scene,
    onOpenMenu: () => {},
    onStart: () => {},
  });
  assert.equal(findNode(root, 'catan-view-seat-1')?.text?.startsWith('▸'), true);
  assert.equal(findNode(root, 'catan-player-trade')?.disabled, true);
  await applying;

  root = buildCatanGameRoot({ x: 0, y: 0, w: 140, h: 50 }, {
    driver,
    scene,
    onOpenMenu: () => {},
    onStart: () => {},
  });
  const offerId = state.actionRecords().length;
  assert.ok(findNode(root, `catan-player-trade-${offerId}-blue`));
  assert.equal(findNode(root, `catan-player-trade-${offerId}-cancel`), undefined);

  const responding = scene.playMove({ type: 'acceptTrade' });
  root = buildCatanGameRoot({ x: 0, y: 0, w: 140, h: 50 }, {
    driver,
    scene,
    onOpenMenu: () => {},
    onStart: () => {},
  });
  assert.equal(findNode(root, `catan-player-trade-${offerId}-accept`)?.disabled, true);
  assert.equal(findNode(root, 'catan-live-spectator-preview'), undefined);
  await responding;
});

test('AI trade playback adds resources one at a time before pressing submit', () => {
  const action: CatanAction = {
    type: 'offerTrade',
    give: [0, 2, 0, 0, 0],
    receive: [0, 0, 1, 0, 0],
  };
  const frames = catanActionPlaybackFrames(2, action);
  assert.deepEqual(frames.map((frame) => frame.phase), [
    'opening',
    'editing',
    'editing',
    'editing',
    'ready',
    'pressing',
  ]);
  assert.deepEqual(frames.map((frame) => frame.trade?.give), [
    [0, 0, 0, 0, 0],
    [0, 1, 0, 0, 0],
    [0, 2, 0, 0, 0],
    [0, 2, 0, 0, 0],
    [0, 2, 0, 0, 0],
    [0, 2, 0, 0, 0],
  ]);
  assert.deepEqual(frames.map((frame) => frame.trade?.receive), [
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
    [0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0],
  ]);
  assert.equal(frames.at(-1)?.trade?.via, 'player');
  assert.deepEqual(catanActionPlaybackFrames(1, { type: 'roll' }), [
    { seat: 1, action: { type: 'roll' }, phase: 'pressing' },
  ]);
});

test('presentation pacing delays AI actions but never replays a human click', async () => {
  const aiScene = new CatanGameScene();
  const aiState = new CatanState({ numPlayers: 2, rng: () => 0.5 });
  aiScene.beginSession(aiState, ['red', 'blue'], 0, -1);
  aiScene.setActionPreviewDuration(5);
  const aiBefore = aiState.actionRecords().length;
  const aiMove = aiScene.playMove(aiState.legalActions()[0]);
  assert.equal(aiState.actionRecords().length, aiBefore, 'AI intent should wait for its presentation beat');
  await aiMove;
  assert.equal(aiState.actionRecords().length, aiBefore + 1);

  const humanScene = new CatanGameScene();
  const humanState = new CatanState({ numPlayers: 2, rng: () => 0.5 });
  humanScene.beginSession(humanState, ['red', 'blue'], 0, 0);
  humanScene.setActionPreviewDuration(1_000);
  const humanBefore = humanState.actionRecords().length;
  const humanMove = humanScene.playMove(humanState.legalActions()[0]);
  assert.equal(humanState.actionRecords().length, humanBefore + 1, 'the UI already presented the human click');
  assert.equal(humanScene.actionPreview(), null);
  await humanMove;
});

test('human versus AI keeps the human POV private and responds through the shared trade popup', async () => {
  const scene = new CatanGameScene();
  const driver = new CatanDriver({ scene, syncLive: () => {} });
  const state = driver.start([
    { kind: 'ai', color: 'red', model: 'test/red' },
    { kind: 'human', color: 'blue' },
  ], { autoRun: false, rng: () => 0.5 });
  while (!state.initialPlacementComplete()) await scene.playMove(state.legalActions()[0]);
  await scene.playMove({ type: 'roll' });
  const internals = state as unknown as { hands: number[][] };
  internals.hands[0].fill(0);
  internals.hands[1].fill(0);
  internals.hands[0][resourceIndex('brick')] = 2;
  internals.hands[1][resourceIndex('grain')] = 2;
  await scene.playMove({ type: 'offerTrade', give: [1, 0, 0, 0, 0], receive: [0, 1, 0, 0, 0] });

  const pending = scene.requestHumanMove();
  const root = buildCatanGameRoot({ x: 0, y: 0, w: 140, h: 50 }, {
    driver,
    scene,
    onOpenMenu: () => {},
    onStart: () => {},
  });
  const offerId = state.actionRecords().length;
  assert.equal(findNode(root, 'catan-view-seat-0')?.disabled, true);
  assert.equal(catanLiveView(state, driver, undefined, 0).hand.grain, 2);
  assert.ok(findNode(root, `catan-player-trade-${offerId}-accept`));
  assert.ok(findNode(root, `catan-player-trade-${offerId}-counter`));
  const reject = findNode(root, `catan-player-trade-${offerId}-reject`);
  assert.ok(reject);
  assert.equal(findNode(root, 'catan-live-accept-trade'), undefined);
  reject?.onClick?.();
  const action = await pending;
  assert.deepEqual(action, { type: 'rejectTrade' });
  await scene.playMove(action);
});

test('human versus AI never renders an opponent maritime-trade editor preview', async () => {
  const scene = new CatanGameScene();
  scene.setActionPreviewDuration(5);
  const driver = new CatanDriver({ scene, syncLive: () => {} });
  const state = driver.start([
    { kind: 'ai', color: 'red', model: 'test/red' },
    { kind: 'human', color: 'blue' },
  ], { autoRun: false, rng: () => 0.5 });
  while (!state.initialPlacementComplete()) await scene.playMove(state.legalActions()[0]);
  await scene.playMove({ type: 'roll' });
  const internals = state as unknown as { hands: number[][] };
  internals.hands[0].fill(0);
  internals.hands[0][resourceIndex('brick')] = 4;

  const applying = scene.playMove({ type: 'maritimeBulkTrade', via: 'bank', give: 'brick', gets: ['ore'] });
  const root = buildCatanGameRoot({ x: 0, y: 0, w: 140, h: 50 }, {
    driver,
    scene,
    onOpenMenu: () => {},
    onStart: () => {},
  });
  assert.equal(findNode(root, 'catan-trade-confirm'), undefined);
  assert.equal(findNode(root, 'catan-trade-close'), undefined);
  await applying;
});

test('human versus AI does not mirror an opponent trade-response button press', async () => {
  const scene = new CatanGameScene();
  scene.setActionPreviewDuration(5);
  const driver = new CatanDriver({ scene, syncLive: () => {} });
  const state = driver.start([
    { kind: 'human', color: 'red' },
    { kind: 'ai', color: 'blue', model: 'test/blue' },
  ], { autoRun: false, rng: () => 0.5 });
  while (!state.initialPlacementComplete()) await scene.playMove(state.legalActions()[0]);
  await scene.playMove({ type: 'roll' });
  const internals = state as unknown as { hands: number[][] };
  internals.hands[0].fill(0);
  internals.hands[1].fill(0);
  internals.hands[0][resourceIndex('brick')] = 1;
  internals.hands[1][resourceIndex('grain')] = 1;
  await scene.playMove({ type: 'offerTrade', give: [1, 0, 0, 0, 0], receive: [0, 1, 0, 0, 0] });
  const offerId = state.actionRecords().length;

  const applying = scene.playMove({ type: 'acceptTrade' });
  const root = buildCatanGameRoot({ x: 0, y: 0, w: 140, h: 50 }, {
    driver,
    scene,
    onOpenMenu: () => {},
    onStart: () => {},
  });
  assert.equal(findNode(root, `catan-player-trade-${offerId}-accept`), undefined);
  await applying;
});

test('spectator mode still renders model maritime-trade editor previews', async () => {
  const scene = new CatanGameScene();
  scene.setActionPreviewDuration(5);
  const driver = new CatanDriver({ scene, syncLive: () => {} });
  const state = driver.start([
    { kind: 'ai', color: 'red', model: 'test/red' },
    { kind: 'ai', color: 'blue', model: 'test/blue' },
  ], { autoRun: false, rng: () => 0.5 });
  while (!state.initialPlacementComplete()) await scene.playMove(state.legalActions()[0]);
  await scene.playMove({ type: 'roll' });
  const internals = state as unknown as { hands: number[][] };
  internals.hands[0].fill(0);
  internals.hands[0][resourceIndex('brick')] = 4;

  const applying = scene.playMove({ type: 'maritimeBulkTrade', via: 'bank', give: 'brick', gets: ['ore'] });
  const root = buildCatanGameRoot({ x: 0, y: 0, w: 140, h: 50 }, {
    driver,
    scene,
    onOpenMenu: () => {},
    onStart: () => {},
  });
  assert.ok(findNode(root, 'catan-trade-confirm'));
  await applying;
});

test('spectated AI roll actions visibly press the same live control before applying', async () => {
  const scene = new CatanGameScene();
  scene.setActionPreviewDuration(5);
  const driver = new CatanDriver({ scene, syncLive: () => {} });
  const state = driver.start([
    { kind: 'ai', color: 'red', model: 'test/red' },
    { kind: 'ai', color: 'blue', model: 'test/blue' },
  ], { autoRun: false, rng: () => 0.5 });
  while (!state.initialPlacementComplete()) await scene.playMove(state.legalActions()[0]);

  const applying = scene.playMove({ type: 'roll' });
  const root = buildCatanGameRoot({ x: 0, y: 0, w: 140, h: 50 }, {
    driver,
    scene,
    onOpenMenu: () => {},
    onStart: () => {},
  });
  const roll = findNode(root, 'catan-live-spectator-preview');
  assert.equal(roll?.disabled, true);
  assert.equal(roll?.text, '⚄ roll');
  await applying;
});

test('a live rolled seven automatically opens the shared discard row for exactly half the hand', async () => {
  const scene = new CatanGameScene();
  const driver = new CatanDriver({ scene, syncLive: () => {} });
  const seats: CatanSeatSpec[] = [
    { kind: 'human', color: 'red' },
    { kind: 'ai', color: 'blue', model: 'test/blue' },
  ];
  const state = driver.start(seats, { autoRun: false, rng: () => 0.5 });
  while (state.currentPrompt().kind === 'initialSettlement' || state.currentPrompt().kind === 'initialRoad') {
    await scene.playMove(state.legalActions()[0]);
  }
  const hands = (state as unknown as { hands: number[][] }).hands;
  hands[0].fill(0);
  hands[0][resourceIndex('brick')] = 5;
  hands[0][resourceIndex('grain')] = 4;
  state.applyAction({ type: 'roll' }, { dice: [3, 4] });
  assert.deepEqual(state.currentPrompt(), { kind: 'discard', player: 0 });

  const pending = scene.requestHumanMove();
  assert.equal(scene.humanMenuKind(), 'discard');
  const root = buildCatanGameRoot({ x: 0, y: 0, w: 140, h: 50 }, {
    driver,
    scene,
    onOpenMenu: () => {},
    onStart: () => {},
  });
  assert.equal(findNode(root, 'catan-discard-confirm')?.disabled, true);
  assert.equal(findNode(root, 'catan-live-discard'), undefined);

  for (let i = 0; i < 3; i++) assert.equal(scene.pickHumanMenuResource('brick'), true);
  assert.equal(scene.pickHumanMenuResource('grain'), true);
  assert.equal(scene.humanMenuCanSubmit(), true);
  assert.equal(scene.removeHumanDiscardResource('brick'), true);
  assert.equal(scene.humanMenuCanSubmit(), false);
  assert.equal(scene.pickHumanMenuResource('brick'), true);
  assert.equal(scene.submitHumanMenu(), true);
  assert.deepEqual(await pending, { type: 'discard', resources: ['brick', 'brick', 'grain', 'brick'] });
});

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

test('the unified live trade editor submits a bulk bank trade from its four-row staging model', async () => {
  const state = new CatanState({ numPlayers: 2, domesticTrade: true, rng: () => 0.5 });
  const scene = new CatanGameScene();
  scene.beginSession(state, ['red', 'blue'], 0);
  while (state.currentPrompt().kind === 'initialSettlement' || state.currentPrompt().kind === 'initialRoad') {
    await scene.playMove(state.legalActions()[0]);
  }
  await scene.playMove({ type: 'roll' });

  const internals = state as unknown as { hands: number[][] };
  internals.hands[0].fill(0);
  internals.hands[0][resourceIndex('brick')] = 8;
  const pending = scene.requestHumanMove();
  assert.equal(scene.beginHumanMenu('tradeEditor'), true);
  for (let i = 0; i < 8; i++) assert.equal(scene.adjustHumanTradeResource('brick', 'give', 1), true);
  assert.equal(scene.adjustHumanTradeResource('ore', 'receive', 1), true);
  assert.equal(scene.adjustHumanTradeResource('wool', 'receive', 1), true);
  assert.equal(scene.humanTradeCanSubmit('bank'), true);
  assert.equal(scene.humanTradeCanSubmit('port'), false);
  assert.equal(scene.humanTradeCanSubmit('player'), true);
  assert.equal(scene.submitHumanTrade('bank'), true);
  assert.deepEqual(await pending, {
    type: 'maritimeBulkTrade',
    via: 'bank',
    give: 'brick',
    gets: ['ore', 'wool'],
  } satisfies CatanAction);
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
