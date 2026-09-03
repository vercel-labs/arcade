import assert from 'node:assert/strict';
import test from 'node:test';
import { IslandersState } from '../../../rules/islanders/islanders.ts';
import { DEV_CARD_TYPES, RESOURCES, resourceIndex, type IslandersAction, type Prompt } from '../../../rules/islanders/types.ts';
import { Screen, type Node } from '../../../tui/index.ts';
import type { KeyEvent } from '../../../platform/input.ts';
import { IslandersDriver, type IslandersSeatSpec } from '../../match/islanders-driver.ts';
import { buildIslandersGameRoot, islandersLiveView, islandersStatusLine } from './game-hud.ts';
import { islandersSidebarOpen, islandersSidebarPlayers, toggleIslandersSidebar } from './card-hud.ts';
import { IslandersGameScene, islandersActionPlaybackFrames } from './game-scene.ts';
import { PLAYER_LOOK } from './palette.ts';
import { ARCADE_OUTLINE_CONTROL } from '../../theme.ts';

function findNode(node: Node, id: string): Node | undefined {
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return undefined;
}

function allText(node: Node): string[] {
  return [node.text ?? '', ...(node.children ?? []).flatMap(allText)].filter(Boolean);
}

test('pre-game setup ignores board hover until a session starts', () => {
  const scene = new IslandersGameScene();
  let forwarded = 0;
  scene.scene.hoverBoard = () => { forwarded++; };
  scene.hoverAt(0, 0);
  assert.equal(forwarded, 0);

  const state = new IslandersState({ numPlayers: 2, rng: () => 0.5 });
  void scene.beginSession(state, ['red', 'blue'], 0, 0);
  scene.hoverAt(0, 0);
  assert.equal(forwarded, 1, 'live legal-placement hover remains enabled');
});

test('initial-turn status stays hidden until the board setup presentation completes', () => {
  const scene = new IslandersGameScene();
  const driver = new IslandersDriver({ scene, syncLive: () => {} });
  driver.start([
    { kind: 'human', color: 'red' },
    { kind: 'ai', color: 'blue', model: 'test/blue' },
  ], { autoRun: false });
  const root = buildIslandersGameRoot({ x: 0, y: 0, w: 140, h: 50 }, {
    driver,
    scene,
    onOpenMenu: () => {},
    onStart: () => {},
  });
  assert.equal(allText(root).some((text) => text.includes('your turn')), false);
});

test('Islanders setup uses the shared rounded new-match CTA', () => {
  const scene = new IslandersGameScene();
  const driver = new IslandersDriver({ scene, syncLive: () => {} });
  const root = buildIslandersGameRoot({ x: 0, y: 0, w: 140, h: 50 }, {
    driver,
    scene,
    onOpenMenu: () => {},
    onStart: () => {},
  });
  const start = findNode(root, 'islanders-start');
  assert.equal(start?.text, 'new match');
  assert.equal(start?.style.border, 'round');
  assert.equal(start?.style.color, ARCADE_OUTLINE_CONTROL.neutralText);
});

test('setup menu stays at the true top-right even when a previous sidebar remains open', () => {
  const scene = new IslandersGameScene();
  const driver = new IslandersDriver({ scene, syncLive: () => {} });
  if (!islandersSidebarOpen()) toggleIslandersSidebar();
  const region = { x: 0, y: 0, w: 140, h: 50 };
  const root = buildIslandersGameRoot(region, {
    driver,
    scene,
    onOpenMenu: () => {},
    onStart: () => {},
  });
  const screen = new Screen(region.w, region.h);
  screen.setRoot(root, region);
  const menu = findNode(root, 'islanders-game-menu');
  assert.ok(menu?.layout);
  assert.equal(menu.layout.x + menu.layout.w, region.w - 2, 'no ghost rail shifts setup chrome left');
  if (islandersSidebarOpen()) toggleIslandersSidebar();
});

test('live status is one borderless row with color confined to the actor', () => {
  const scene = new IslandersGameScene();
  const driver = new IslandersDriver({ scene, syncLive: () => {} });
  driver.start([
    { kind: 'human', color: 'red' },
    { kind: 'ai', color: 'blue', model: 'test/blue' },
  ], { autoRun: false });
  (scene as unknown as { setupComplete: boolean }).setupComplete = true;
  const root = buildIslandersGameRoot({ x: 0, y: 0, w: 140, h: 50 }, {
    driver,
    scene,
    onOpenMenu: () => {},
    onStart: () => {},
  });
  const banner = findNode(root, 'islanders-status-banner');
  assert.ok(banner);
  assert.equal(banner.style.flexDirection, 'row');
  assert.equal(banner.style.background, undefined);
  assert.equal(banner.children?.length, 2);
  assert.equal(banner.children?.[0]?.text, 'Your turn');
  assert.equal(banner.children?.[0]?.style.color, PLAYER_LOOK.red);
  assert.equal(banner.children?.[1]?.text, ' · place your first settlement');
  assert.notEqual(banner.children?.[1]?.style.color, PLAYER_LOOK.red);
});

test('pending status names every required human action and the exact discard count', async () => {
  const scene = new IslandersGameScene();
  const driver = new IslandersDriver({ scene, syncLive: () => {} });
  const state = driver.start([
    { kind: 'human', color: 'red' },
    { kind: 'ai', color: 'blue', model: 'test/claude' },
  ], { autoRun: false, rng: () => 0.5 });
  const internals = state as unknown as { prompt: Prompt; discardRemaining: number[] };
  const status = (prompt: Prompt): string => {
    internals.prompt = prompt;
    const line = islandersStatusLine(driver);
    return `${line?.actor} ${line?.narration}`;
  };

  assert.equal(status({ kind: 'initialSettlement', player: 0 }), 'Your turn · place your first settlement');
  await scene.playMove(state.legalActions()[0]);
  assert.equal(status({ kind: 'initialRoad', player: 0 }), 'Your turn · place a road beside it');
  while (state.initialSettlementCount(0) < 1) state.applyAction(state.legalActions()[0]);
  assert.equal(status({ kind: 'initialSettlement', player: 0 }), 'Your turn · place your second settlement');
  assert.equal(status({ kind: 'roll', player: 0 }), 'Your turn · roll or play a development card');
  assert.equal(status({ kind: 'playTurn', player: 0 }), 'Your turn · build, trade, or end turn');
  internals.discardRemaining[0] = 4;
  assert.equal(status({ kind: 'discard', player: 0 }), 'Your turn · discard 4 cards');
  assert.equal(status({ kind: 'moveRobber', player: 0 }), 'Your turn · move the robber');
  assert.equal(status({ kind: 'respondTrade', player: 0 }), 'Your turn · respond to the trade');
  assert.equal(status({ kind: 'decideAcceptees', player: 0 }), 'Your turn · choose a trade partner');
});

test('pending status gives concise phase context while a model is deciding', () => {
  const scene = new IslandersGameScene();
  const driver = new IslandersDriver({ scene, syncLive: () => {} });
  const state = driver.start([
    { kind: 'human', color: 'red' },
    { kind: 'ai', color: 'blue', model: 'test/claude' },
  ], { autoRun: false, rng: () => 0.5 });
  const internals = state as unknown as { prompt: Prompt; discardRemaining: number[] };
  const status = (prompt: Prompt): string => {
    internals.prompt = prompt;
    const line = islandersStatusLine(driver);
    return `${line?.actor} ${line?.narration}`;
  };

  assert.equal(status({ kind: 'initialSettlement', player: 1 }), 'claude · choosing where to place a settlement');
  assert.equal(status({ kind: 'initialRoad', player: 1 }), 'claude · choosing where to build a road');
  assert.equal(status({ kind: 'roll', player: 1 }), 'claude · starting their turn');
  assert.equal(status({ kind: 'playTurn', player: 1 }), 'claude · considering their next move');
  internals.discardRemaining[1] = 4;
  assert.equal(status({ kind: 'discard', player: 1 }), 'claude · discarding 4 cards');
  assert.equal(status({ kind: 'moveRobber', player: 1 }), 'claude · choosing where to move the robber');
  assert.equal(status({ kind: 'respondTrade', player: 1 }), 'claude · considering the trade');
  assert.equal(status({ kind: 'decideAcceptees', player: 1 }), 'claude · choosing a trade partner');
});

test('compact status stays between the player legend and top-right controls', () => {
  const scene = new IslandersGameScene();
  const driver = new IslandersDriver({ scene, syncLive: () => {} });
  driver.start([
    { kind: 'human', color: 'red' },
    { kind: 'ai', color: 'blue', model: 'test/claude' },
  ], { autoRun: false, rng: () => 0.5 });
  (scene as unknown as { setupComplete: boolean }).setupComplete = true;
  const root = buildIslandersGameRoot({ x: 0, y: 0, w: 100, h: 36 }, {
    driver,
    scene,
    onOpenMenu: () => {},
    onStart: () => {},
  });
  const screen = new Screen(100, 36);
  screen.setRoot(root, { x: 0, y: 0, w: 100, h: 36 });
  const banner = findNode(root, 'islanders-status-banner');
  assert.ok(banner);
  const statusHost = (function parentOf(node: Node): Node | undefined {
    if (node.children?.includes(banner)) return node;
    for (const child of node.children ?? []) {
      const parent = parentOf(child);
      if (parent) return parent;
    }
    return undefined;
  })(root);
  assert.ok(statusHost?.layout);
  assert.ok(statusHost.layout.x >= 33);
  assert.ok(statusHost.layout.x + statusHost.layout.w <= 89);
});

test('status narration agrees with human and model actor labels', () => {
  const scene = new IslandersGameScene();
  const driver = new IslandersDriver({ scene, syncLive: () => {} });
  driver.start([
    { kind: 'human', color: 'red' },
    { kind: 'ai', color: 'blue', model: 'test/claude' },
  ], { autoRun: false });
  assert.equal(islandersStatusLine(driver, { seat: 0, action: { type: 'roll' }, phase: 'pressing' })?.narration, 'are rolling dice');
  assert.equal(islandersStatusLine(driver, { seat: 1, action: { type: 'roll' }, phase: 'pressing' })?.narration, 'is rolling dice');
  assert.equal(islandersStatusLine(driver, { seat: 0, action: { type: 'moveRobber', hex: 1, victim: null }, phase: 'pressing' })?.narration, 'are moving the robber');
  assert.equal(islandersStatusLine(driver, { seat: 1, action: { type: 'acceptTrade' }, phase: 'pressing' })?.narration, 'is accepting the trade');
});

test('the live hand owns the shared trade and buy-dev cards while new game stays in the menu', async () => {
  const scene = new IslandersGameScene();
  const driver = new IslandersDriver({ scene, syncLive: () => {} });
  const seats: IslandersSeatSpec[] = [
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
  const root = buildIslandersGameRoot({ x: 0, y: 0, w: 140, h: 50 }, {
    driver,
    scene,
    onOpenMenu: () => {},
    onStart: () => {},
  });

  assert.equal(findNode(root, 'islanders-trade-open')?.disabled, false);
  assert.equal(findNode(root, 'islanders-buy-dev')?.disabled, false);
  assert.ok(findNode(root, 'islanders-live-end'));
  assert.equal(findNode(root, 'islanders-live-trade'), undefined);
  assert.equal(findNode(root, 'islanders-live-buy-dev'), undefined);
  assert.equal(findNode(root, 'islanders-new-game'), undefined);

  assert.equal(scene.submitHumanAction({ type: 'endTurn' }), true);
  await pending;
});

test('the roll card sits in the hand action row, sized like the other action cards', async () => {
  const scene = new IslandersGameScene();
  const driver = new IslandersDriver({ scene, syncLive: () => {} });
  const state = driver.start([
    { kind: 'human', color: 'red' },
    { kind: 'ai', color: 'blue', model: 'test/blue' },
  ], { autoRun: false, rng: () => 0.5 });
  while (!state.initialPlacementComplete()) await scene.playMove(state.legalActions()[0]);
  assert.equal(state.currentPrompt().kind, 'roll');
  void scene.requestHumanMove();

  const root = buildIslandersGameRoot({ x: 0, y: 0, w: 140, h: 50 }, {
    driver,
    scene,
    onOpenMenu: () => {},
    onStart: () => {},
  });
  const screen = new Screen(140, 50);
  screen.setRoot(root, { x: 0, y: 0, w: 140, h: 50 });
  const roll = findNode(root, 'islanders-live-roll');
  const buyDev = findNode(root, 'islanders-buy-dev');
  assert.ok(roll?.layout && buyDev?.layout);
  // The turn's required action is a card in the hand's action row, right after buy dev and the
  // same size, in its own color; end turn is not offered until the dice have been rolled.
  assert.equal(roll.layout.w, buyDev.layout.w);
  assert.equal(roll.layout.h, buyDev.layout.h);
  assert.equal(roll.layout.y, buyDev.layout.y);
  assert.ok(roll.layout.x > buyDev.layout.x);
  assert.notDeepEqual(roll.style.background, buyDev.style.background);
  assert.equal(findNode(root, 'islanders-live-end'), undefined);
});

test('spectators can click a player to inspect that seat hand and development cards', () => {
  const scene = new IslandersGameScene();
  const driver = new IslandersDriver({ scene, syncLive: () => {} });
  const state = driver.start([
    { kind: 'ai', color: 'red', model: 'test/red' },
    { kind: 'ai', color: 'blue', model: 'test/blue' },
  ], { autoRun: false, rng: () => 0.5 });
  const internals = state as unknown as { hands: number[][]; devHand: number[][] };
  internals.hands[0].fill(0);
  internals.hands[1].fill(0);
  internals.hands[1][resourceIndex('ore')] = 3;
  internals.devHand[1][DEV_CARD_TYPES.indexOf('knight')] = 2;

  let root = buildIslandersGameRoot({ x: 0, y: 0, w: 140, h: 50 }, {
    driver,
    scene,
    onOpenMenu: () => {},
    onStart: () => {},
  });
  const blue = findNode(root, 'islanders-view-seat-1');
  assert.equal(blue?.disabled, false);
  blue?.onClick?.();
  assert.equal(scene.viewedSeat(), 1);

  root = buildIslandersGameRoot({ x: 0, y: 0, w: 140, h: 50 }, {
    driver,
    scene,
    onOpenMenu: () => {},
    onStart: () => {},
  });
  assert.equal(findNode(root, 'islanders-view-seat-1')?.text?.startsWith('▸'), true);
  const view = islandersLiveView(state, driver, undefined, 1);
  assert.equal(view.hand.ore, 3);
  assert.equal(view.devHand.knight, 2);
  assert.deepEqual(islandersSidebarPlayers(view).map((player) => player.seat), [0, 1]);
});

test('spectator POV changes never reorder the sidebar player rows', () => {
  const scene = new IslandersGameScene();
  const driver = new IslandersDriver({ scene, syncLive: () => {} });
  const state = driver.start([
    { kind: 'ai', color: 'red', model: 'test/red' },
    { kind: 'ai', color: 'blue', model: 'test/blue' },
    { kind: 'ai', color: 'orange', model: 'test/orange' },
    { kind: 'ai', color: 'purple', model: 'test/purple' },
  ], { autoRun: false, rng: () => 0.5 });

  for (const viewer of [0, 2, 3, 1]) {
    const view = islandersLiveView(state, driver, undefined, viewer);
    assert.equal(view.localPlayer.seat, viewer);
    assert.deepEqual(islandersSidebarPlayers(view).map((player) => player.seat), [0, 1, 2, 3]);
  }
});

test('an AI trade visibly stages in the shared editor before becoming a posted trade popup', async () => {
  const scene = new IslandersGameScene();
  scene.setActionPreviewDuration(5);
  const driver = new IslandersDriver({ scene, syncLive: () => {} });
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
  const offer: IslandersAction = { type: 'offerTrade', give: [1, 0, 0, 0, 0], receive: [0, 1, 0, 0, 0] };
  scene.setViewedSeat(1);

  const applying = scene.playMove(offer);
  assert.deepEqual(scene.actionPreview(), {
    seat: 0,
    action: offer,
    phase: 'opening',
    trade: { mode: 'standard', give: [0, 0, 0, 0, 0], receive: [0, 0, 0, 0, 0] },
  });
  assert.deepEqual(islandersStatusLine(driver, scene.actionPreview()), {
    actor: 'red',
    narration: 'is preparing a trade',
    color: [226, 96, 84],
  });
  let root = buildIslandersGameRoot({ x: 0, y: 0, w: 140, h: 50 }, {
    driver,
    scene,
    onOpenMenu: () => {},
    onStart: () => {},
  });
  assert.equal(findNode(root, 'islanders-view-seat-1')?.text?.startsWith('▸'), true);
  assert.equal(findNode(root, 'islanders-player-trade')?.disabled, true);
  await applying;

  root = buildIslandersGameRoot({ x: 0, y: 0, w: 140, h: 50 }, {
    driver,
    scene,
    onOpenMenu: () => {},
    onStart: () => {},
  });
  const offerId = state.actionRecords().length;
  assert.ok(findNode(root, `islanders-player-trade-${offerId}-blue`));
  assert.equal(findNode(root, `islanders-player-trade-${offerId}-cancel`), undefined);

  const responding = scene.playMove({ type: 'acceptTrade' });
  root = buildIslandersGameRoot({ x: 0, y: 0, w: 140, h: 50 }, {
    driver,
    scene,
    onOpenMenu: () => {},
    onStart: () => {},
  });
  assert.equal(findNode(root, `islanders-player-trade-${offerId}-accept`)?.disabled, true);
  assert.equal(findNode(root, 'islanders-live-spectator-preview'), undefined);
  await responding;
});

test('AI trade playback adds resources one at a time before pressing submit', () => {
  const action: IslandersAction = {
    type: 'offerTrade',
    give: [0, 2, 0, 0, 0],
    receive: [0, 0, 1, 0, 0],
  };
  const frames = islandersActionPlaybackFrames(2, action);
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
  assert.deepEqual(islandersActionPlaybackFrames(1, { type: 'roll' }), [
    { seat: 1, action: { type: 'roll' }, phase: 'pressing' },
  ]);
});

test('presentation pacing delays AI actions but never replays a human click', async () => {
  const aiScene = new IslandersGameScene();
  const aiState = new IslandersState({ numPlayers: 2, rng: () => 0.5 });
  aiScene.beginSession(aiState, ['red', 'blue'], 0, -1);
  aiScene.setActionPreviewDuration(5);
  const aiBefore = aiState.actionRecords().length;
  const aiMove = aiScene.playMove(aiState.legalActions()[0]);
  assert.equal(aiState.actionRecords().length, aiBefore, 'AI intent should wait for its presentation beat');
  await aiMove;
  assert.equal(aiState.actionRecords().length, aiBefore + 1);

  const humanScene = new IslandersGameScene();
  const humanState = new IslandersState({ numPlayers: 2, rng: () => 0.5 });
  humanScene.beginSession(humanState, ['red', 'blue'], 0, 0);
  humanScene.setActionPreviewDuration(1_000);
  const humanBefore = humanState.actionRecords().length;
  const humanMove = humanScene.playMove(humanState.legalActions()[0]);
  assert.equal(humanState.actionRecords().length, humanBefore + 1, 'the UI already presented the human click');
  assert.equal(humanScene.actionPreview(), null);
  await humanMove;
});

test('human versus AI keeps the human POV private and responds through the shared trade popup', async () => {
  const scene = new IslandersGameScene();
  const driver = new IslandersDriver({ scene, syncLive: () => {} });
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
  const root = buildIslandersGameRoot({ x: 0, y: 0, w: 140, h: 50 }, {
    driver,
    scene,
    onOpenMenu: () => {},
    onStart: () => {},
  });
  const offerId = state.actionRecords().length;
  assert.equal(findNode(root, 'islanders-view-seat-0')?.disabled, true);
  assert.equal(islandersLiveView(state, driver, undefined, 0).hand.grain, 2);
  assert.ok(findNode(root, `islanders-player-trade-${offerId}-accept`));
  assert.ok(findNode(root, `islanders-player-trade-${offerId}-counter`));
  const reject = findNode(root, `islanders-player-trade-${offerId}-reject`);
  assert.ok(reject);
  assert.equal(findNode(root, 'islanders-live-accept-trade'), undefined);
  reject?.onClick?.();
  const action = await pending;
  assert.deepEqual(action, { type: 'rejectTrade' });
  await scene.playMove(action);
});

test('human versus AI never renders an opponent maritime-trade editor preview', async () => {
  const scene = new IslandersGameScene();
  scene.setActionPreviewDuration(5);
  const driver = new IslandersDriver({ scene, syncLive: () => {} });
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
  const root = buildIslandersGameRoot({ x: 0, y: 0, w: 140, h: 50 }, {
    driver,
    scene,
    onOpenMenu: () => {},
    onStart: () => {},
  });
  assert.equal(findNode(root, 'islanders-trade-confirm'), undefined);
  assert.equal(findNode(root, 'islanders-trade-close'), undefined);
  await applying;
});

test('human versus AI does not mirror an opponent trade-response button press', async () => {
  const scene = new IslandersGameScene();
  scene.setActionPreviewDuration(5);
  const driver = new IslandersDriver({ scene, syncLive: () => {} });
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
  const root = buildIslandersGameRoot({ x: 0, y: 0, w: 140, h: 50 }, {
    driver,
    scene,
    onOpenMenu: () => {},
    onStart: () => {},
  });
  assert.equal(findNode(root, `islanders-player-trade-${offerId}-accept`), undefined);
  await applying;
});

test('spectator mode still renders model maritime-trade editor previews', async () => {
  const scene = new IslandersGameScene();
  scene.setActionPreviewDuration(5);
  const driver = new IslandersDriver({ scene, syncLive: () => {} });
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
  const root = buildIslandersGameRoot({ x: 0, y: 0, w: 140, h: 50 }, {
    driver,
    scene,
    onOpenMenu: () => {},
    onStart: () => {},
  });
  assert.ok(findNode(root, 'islanders-trade-confirm'));
  await applying;
});

test('spectated AI actions do not flash transient controls above the persistent hand actions', async () => {
  const scene = new IslandersGameScene();
  scene.setActionPreviewDuration(5);
  const driver = new IslandersDriver({ scene, syncLive: () => {} });
  const state = driver.start([
    { kind: 'ai', color: 'red', model: 'test/red' },
    { kind: 'ai', color: 'blue', model: 'test/blue' },
  ], { autoRun: false, rng: () => 0.5 });
  while (!state.initialPlacementComplete()) await scene.playMove(state.legalActions()[0]);

  const applying = scene.playMove({ type: 'roll' });
  const root = buildIslandersGameRoot({ x: 0, y: 0, w: 140, h: 50 }, {
    driver,
    scene,
    onOpenMenu: () => {},
    onStart: () => {},
  });
  assert.equal(findNode(root, 'islanders-live-spectator-preview'), undefined);
  assert.ok(findNode(root, 'islanders-trade-open'));
  assert.ok(findNode(root, 'islanders-buy-dev'));
  await applying;
});

test('a live rolled seven automatically opens the shared discard row for exactly half the hand', async () => {
  const scene = new IslandersGameScene();
  const driver = new IslandersDriver({ scene, syncLive: () => {} });
  const seats: IslandersSeatSpec[] = [
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
  const root = buildIslandersGameRoot({ x: 0, y: 0, w: 140, h: 50 }, {
    driver,
    scene,
    onOpenMenu: () => {},
    onStart: () => {},
  });
  assert.equal(findNode(root, 'islanders-discard-confirm')?.disabled, true);
  assert.equal(findNode(root, 'islanders-live-discard'), undefined);

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
  const state = new IslandersState({ numPlayers: 2, domesticTrade: true, rng: () => 0.5 });
  const scene = new IslandersGameScene();
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
  } satisfies IslandersAction);
  await scene.playMove(action);
  assert.equal(state.handOf(0)[resourceIndex('brick')], 0);
  assert.equal(state.handOf(0)[resourceIndex('ore')], 1);
  assert.equal(state.handOf(0)[resourceIndex('wool')], 1);
  assert.equal(RESOURCES.reduce((sum, resource) => sum + (scene.resourceViewAdjustments().handPendingDeparture?.[resource] ?? 0), 0), 8);
  assert.equal(RESOURCES.reduce((sum, resource) => sum + scene.resourceViewAdjustments().handPending[resource], 0), gainsBefore + 2);
});

test('the unified live trade editor submits a bulk bank trade from its four-row staging model', async () => {
  const state = new IslandersState({ numPlayers: 2, domesticTrade: true, rng: () => 0.5 });
  const scene = new IslandersGameScene();
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
  } satisfies IslandersAction);
});

test('a human responder opens the posted trade as a prefilled editable counteroffer', async () => {
  const state = new IslandersState({ numPlayers: 2, domesticTrade: true, rng: () => 0.5 });
  const scene = new IslandersGameScene();
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
  } satisfies IslandersAction);
});

test('a submitted human counteroffer renders separately and can be withdrawn', async () => {
  const scene = new IslandersGameScene();
  const driver = new IslandersDriver({ scene, syncLive: () => {} });
  const state = driver.start([
    { kind: 'ai', color: 'red', model: 'test/red' },
    { kind: 'human', color: 'blue' },
    { kind: 'ai', color: 'orange', model: 'test/orange' },
  ], { autoRun: false, rng: () => 0.5 });
  while (!state.initialPlacementComplete()) state.applyAction(state.legalActions()[0]);
  await scene.playMove({ type: 'roll' });
  const hands = (state as unknown as { hands: number[][] }).hands;
  hands[0].fill(0); hands[1].fill(0); hands[2].fill(0);
  hands[0][resourceIndex('brick')] = 2;
  hands[1][resourceIndex('grain')] = 2;
  await scene.playMove({ type: 'offerTrade', give: [1, 0, 0, 0, 0], receive: [0, 1, 0, 0, 0] });
  await scene.playMove({ type: 'counterTrade', give: [0, 2, 0, 0, 0], receive: [1, 0, 0, 0, 0] });

  let root = buildIslandersGameRoot({ x: 0, y: 0, w: 140, h: 50 }, { driver, scene, onOpenMenu: () => {}, onStart: () => {} });
  const withdraw = findNode(root, `islanders-player-trade-${state.actionRecords().length}-You-counter-withdraw`);
  assert.ok(withdraw, 'the human counteroffer has its own withdraw action');
  withdraw.onClick?.();
  assert.equal(state.activeTrade()?.counters.length, 0);
  root = buildIslandersGameRoot({ x: 0, y: 0, w: 140, h: 50 }, { driver, scene, onOpenMenu: () => {}, onStart: () => {} });
  assert.equal(allText(root).some((text) => text.includes('your counteroffer')), false);
});

test('the robber victim picker is a legend-styled column that arrow keys walk and Enter commits', async () => {
  const scene = new IslandersGameScene();
  const driver = new IslandersDriver({ scene, syncLive: () => {} });
  const state = driver.start([
    { kind: 'human', color: 'red' },
    { kind: 'ai', color: 'blue', model: 'test/blue' },
    { kind: 'ai', color: 'orange', model: 'test/orange' },
  ], { autoRun: false, rng: () => 0.5 });
  while (!state.initialPlacementComplete()) state.applyAction(state.legalActions()[0]);
  // Stage a hex the robber can move to with two robbable neighbours, then pick it: the scene
  // holds the candidates and asks who to steal from.
  const hands = (state as unknown as { hands: number[][] }).hands;
  hands.forEach((hand) => hand.fill(1));
  state.applyAction({ type: 'roll' }, { dice: [3, 4] });
  assert.equal(state.currentPrompt().kind, 'moveRobber');
  const pending = scene.requestHumanMove();
  const byHex = new Map<number, number>();
  for (const action of state.legalActions()) if (action.type === 'moveRobber' && action.victim !== null) byHex.set(action.hex, (byHex.get(action.hex) ?? 0) + 1);
  const hex = [...byHex.entries()].find(([, count]) => count >= 2)?.[0];
  assert.notEqual(hex, undefined, 'a hex with two robbable neighbours');
  const internals = scene as unknown as { robberVictims: IslandersAction[] };
  internals.robberVictims = state.legalActions().filter((action) => action.type === 'moveRobber' && action.hex === hex);
  const victims = scene.robberVictimSeats();
  assert.ok(victims.length >= 2);

  const screen = new Screen(140, 50);
  const region = { x: 0, y: 0, w: 140, h: 50 };
  const build = (): Node => buildIslandersGameRoot(region, { driver, scene, onOpenMenu: () => {}, onStart: () => {} });
  const { mountIslandersGameHud } = await import('./game-hud.ts');
  mountIslandersGameHud(screen);
  let root = build();
  screen.setRoot(root, region);
  const rows = victims.map((victim) => findNode(root, `islanders-live-victim-${victim ?? 'none'}`)!);
  assert.ok(rows.every(Boolean));
  // A column, not a row: each victim sits below the previous, colored like the legend.
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i].layout!.y > rows[i - 1].layout!.y);
    assert.equal(rows[i].layout!.x, rows[i - 1].layout!.x);
  }
  assert.deepEqual(rows[0].style.color, PLAYER_LOOK[driver.colorOf(victims[0]!)]);
  assert.ok(rows[0].text?.startsWith('■ '));
  // Focus opens on the first row; ↓ moves it; Enter steals from the focused seat.
  const focused = (): string | null => (screen as unknown as { state: { focusId: string | null } }).state.focusId;
  assert.equal(focused(), rows[0].id);
  const key = (name: string): KeyEvent => ({ name, raw: '', sequence: '', ctrl: false, meta: false, shift: false, eventType: 'press' });
  screen.handleKey(key('down'));
  root = build();
  screen.setRoot(root, region);
  assert.equal(focused(), rows[1].id);
  screen.handleKey(key('enter'));
  const chosen = await pending;
  assert.deepEqual(chosen, { type: 'moveRobber', hex, victim: victims[1] });
});
