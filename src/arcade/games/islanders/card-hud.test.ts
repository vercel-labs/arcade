// Scene-level only. The card HUD's presentation (labels, casing, glyphs, widths, which stats
// show) is in fast visual iteration and is deliberately NOT asserted here — those tests break
// every turn and cost more than they catch. Verify the UI with `pnpm snapshot ... board-cards hud`
// and look at the PNG instead.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mulberry32, RenderTarget } from '../../../engine/index.ts';
import { DICE_RESULT_REVEAL_DELAY, DICE_ROLL_DUR, DICE_STAGGER, type Die } from '../../../game-visuals/islanders/dice-choreography.ts';
import { type Node, Screen } from '../../../tui/index.ts';
import { maritimePortTradeRates, maritimeTradeRates } from '../../../rules/islanders/maritime-trade.ts';
import { generateBoard } from '../../../rules/islanders/setup.ts';
import { DEV_CARD_COUNTS } from '../../../rules/islanders/types.ts';
import {
  adjustIslandersWorkbenchDiscard,
  adjustIslandersWorkbenchDev,
  adjustIslandersWorkbenchHand,
  adjustIslandersWorkbenchTradeStaging,
  bankIslandersResource,
  beginIslandersWorkbenchDiscard,
  beginIslandersWorkbenchDevelopmentPlay,
  beginIslandersWorkbenchDevPurchase,
  beginStagedIslandersWorkbenchBankTrade,
  buildIslandersCardsOverlay,
  buyIslandersWorkbenchDevCard,
  canSubmitIslandersWorkbenchDiscard,
  cancelIslandersWorkbenchPlayerTrade,
  islandersWorkbenchPlayerTradeOffers,
  islandersBankDepartureCell,
  islandersDevDeckDepartureCell,
  islandersDevHandLandingCell,
  islandersDiscardDepartureCell,
  islandersHandLandingCell,
  islandersHistoryRows,
  islandersWorkbenchDiscardOpen,
  islandersWorkbenchDiscardRequired,
  islandersWorkbenchDevelopmentPlay,
  islandersWorkbenchView,
  type IslandersTradeEditorController,
  type IslandersPlayerTradeOffersController,
  chooseIslandersWorkbenchDevelopmentResource,
  completeIslandersWorkbenchDevelopmentStep,
  completeIslandersWorkbenchPlayerTrade,
  createIslandersWorkbenchPlayerTrade,
  departIslandersWorkbenchBankResource,
  departIslandersWorkbenchHandResource,
  departIslandersWorkbenchDevCard,
  landIslandersWorkbenchBankResource,
  landIslandersWorkbenchDevCard,
  logIslandersWorkbenchDevPurchase,
  logIslandersWorkbenchMaritimeTrade,
  performIslandersWorkbenchBankTrade,
  performIslandersWorkbenchPortTrade,
  performStagedIslandersWorkbenchBankTrade,
  performStagedIslandersWorkbenchPortTrade,
  resetIslandersWorkbenchCards,
  resolveIslandersWorkbenchPlayerTradeOffer,
  setIslandersTradeEditorOpen,
  submitIslandersWorkbenchDiscard,
} from './card-hud.ts';
import { stagedIslandersBankTrade, stagedIslandersPortTrade } from './card-workbench.ts';
import { IslandersController } from './islanders-controller.ts';
import { ISLANDERS_CARD, DEV_HAND_LOOK } from './palette.ts';
import { TileScene } from './tile-scene.ts';

function findNode(node: Node, id: string): Node | undefined {
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return undefined;
}

test('Islanders action history wraps complete model commentary onto physical continuation rows', () => {
  const message = 'I am attempting to trade for ore because my production portfolio is weak there and the city timing matters.';
  const rows = islandersHistoryRows({ actor: 'grok-4.1-fast-non-reasoning', color: 'red', message, chat: true });
  assert.ok(rows.length > 2);
  const painted = rows.flatMap((row) => row.children?.map((child) => child.text ?? '') ?? [row.text ?? '']).join(' ');
  for (const word of message.split(' ')) assert.ok(painted.includes(word), `missing wrapped word: ${word}`);
});

test('the workbench opens the shared discard row only above seven cards and returns selected cards to the bank', () => {
  resetIslandersWorkbenchCards();
  for (let i = 0; i < 5; i++) adjustIslandersWorkbenchHand('brick', 1);
  for (let i = 0; i < 4; i++) adjustIslandersWorkbenchHand('grain', 1);
  const bankBefore = { ...islandersWorkbenchView().bank };

  assert.equal(beginIslandersWorkbenchDiscard(), true);
  assert.equal(islandersWorkbenchDiscardOpen(), true);
  assert.equal(islandersWorkbenchDiscardRequired(), 4);
  const root = buildIslandersCardsOverlay({ x: 0, y: 0, w: 140, h: 50 }, () => {});
  assert.equal(findNode(root, 'islanders-discard-confirm')?.disabled, true);

  for (let i = 0; i < 3; i++) assert.equal(adjustIslandersWorkbenchDiscard('brick', 1), true);
  assert.equal(adjustIslandersWorkbenchDiscard('grain', 1), true);
  assert.equal(canSubmitIslandersWorkbenchDiscard(), true);
  assert.equal(submitIslandersWorkbenchDiscard(), true);
  assert.equal(islandersWorkbenchDiscardOpen(), false);
  assert.equal(islandersWorkbenchView().hand.brick, 2);
  assert.equal(islandersWorkbenchView().hand.grain, 3);
  assert.equal(islandersWorkbenchView().bank.brick, bankBefore.brick + 3);
  assert.equal(islandersWorkbenchView().bank.grain, bankBefore.grain + 1);

  resetIslandersWorkbenchCards();
  for (let i = 0; i < 7; i++) adjustIslandersWorkbenchHand('wool', 1);
  assert.equal(beginIslandersWorkbenchDiscard(), false);
  resetIslandersWorkbenchCards();
});

test('the full four-row trade editor is shared by live Islanders rather than limited to the workbench', () => {
  const view = islandersWorkbenchView();
  view.source = 'live';
  const counts = { brick: 0, grain: 0, lumber: 0, ore: 0, wool: 0 };
  const controller: IslandersTradeEditorController = {
    mode: 'standard',
    give: { ...counts, brick: 4 },
    receive: { ...counts, ore: 1 },
    hasPort: true,
    canBank: true,
    canPort: false,
    canPlayer: true,
    canCounter: false,
    onAdjust: () => true,
    onBank: () => true,
    onPort: () => false,
    onPlayer: () => true,
    onCounter: () => false,
    onClose: () => {},
  };
  const root = buildIslandersCardsOverlay(
    { x: 0, y: 0, w: 140, h: 50 },
    () => {},
    view,
    () => {},
    undefined,
    undefined,
    undefined,
    undefined,
    controller,
  );

  assert.equal(findNode(root, 'islanders-trade-confirm')?.disabled, false);
  assert.equal(findNode(root, 'islanders-port-trade-confirm')?.disabled, true);
  assert.equal(findNode(root, 'islanders-player-trade')?.disabled, false);
  assert.ok(findNode(root, 'islanders-trade-close'));
});

test('a playable live development card submits through its hand card while VP remains passive', () => {
  const view = islandersWorkbenchView();
  view.source = 'live';
  view.devHand.knight = 1;
  view.devHand.victoryPoint = 1;
  view.playableDevelopmentCards = ['knight'];
  let played = '';
  const root = buildIslandersCardsOverlay(
    { x: 0, y: 0, w: 140, h: 45 },
    () => {},
    view,
    () => {},
    undefined,
    undefined,
    (type) => {
      played = type;
      return true;
    },
  );
  const knight = findNode(root, 'islanders-dev-knight');
  assert.ok(knight?.onMouse);
  assert.equal(knight.onMouse({ type: 'down', x: 0, y: 0, w: 7, h: 6, button: 0 }), true);
  assert.equal(played, 'knight');
  assert.equal(findNode(root, 'islanders-dev-victoryPoint')?.onMouse, undefined);
});

test('Board + cards remains a full board scene with projected number tokens', () => {
  const scene = new TileScene();
  scene.setMode('boardCards');
  scene.settle();
  scene.renderScene(new RenderTarget(140, 100), 0.7);
  assert.equal(scene.currentMode(), 'boardCards');
  assert.equal(scene.boardTokens(140, 50).length, 18);
  assert.equal(scene.boardPortLabels(140, 50).length, 9);
});

test('resource flights land on cards after the hand tray side padding', () => {
  assert.deepEqual(islandersHandLandingCell({ x: 0, y: 0, w: 140, h: 50 }, 'lumber'), { col: 7, row: 44 });
});

test('discard flights leave the staged resource row', () => {
  const region = { x: 0, y: 0, w: 140, h: 50 };
  assert.deepEqual(islandersDiscardDepartureCell(region, 'lumber'), { col: 7, row: 40 });
  assert.notDeepEqual(islandersDiscardDepartureCell(region, 'lumber'), islandersHandLandingCell(region, 'lumber'));
});

test('trade flights leave the visible bank card or the hidden right edge at the same height', () => {
  const region = { x: 0, y: 0, w: 140, h: 50 };
  assert.deepEqual(islandersBankDepartureCell(region, 'ore', 4, true), { col: 126, row: 34 });
  assert.deepEqual(islandersBankDepartureCell(region, 'ore', 4, false), { col: 143, row: 33 });
});

test('development flights leave the dev pile and land on a responsive dev-hand slot', () => {
  const region = { x: 0, y: 0, w: 140, h: 50 };
  const view = islandersWorkbenchView();
  assert.equal(view.source, 'workbench');
  view.pendingDevelopmentCards = ['knight'];
  assert.deepEqual(islandersDevDeckDepartureCell(region, 4, true), { col: 134, row: 34 });
  assert.deepEqual(islandersDevDeckDepartureCell(region, 4, false), { col: 143, row: 33 });
  assert.deepEqual(islandersDevHandLandingCell(region, 'knight', true, view), { col: 49, row: 44 });
  assert.deepEqual(islandersDevHandLandingCell(region, 'knight', false, view), { col: 49, row: 44 });
});

test('a development landing slot stays disabled until the card arrives', () => {
  resetIslandersWorkbenchCards();
  setIslandersTradeEditorOpen(false);
  const region = { x: 0, y: 0, w: 100, h: 50 };
  const view = islandersWorkbenchView();
  view.developmentPurchaseBusy = true;
  view.pendingDevelopmentCards = ['knight'];
  const landing = islandersDevHandLandingCell(region, 'knight', false, view);
  const screen = new Screen(region.w, region.h);

  screen.setRoot(buildIslandersCardsOverlay(region, () => {}, view), region);
  const pending = screen.snapshot(() => {});
  assert.deepEqual(pending.getCell(landing.col, landing.row)?.bg, ISLANDERS_CARD.emptyFill);

  view.devHand.knight = 1;
  view.developmentPurchaseBusy = false;
  delete view.pendingDevelopmentCards;
  screen.setRoot(buildIslandersCardsOverlay(region, () => {}, view), region);
  const landed = screen.snapshot(() => {});
  assert.deepEqual(landed.getCell(landing.col, landing.row)?.bg, DEV_HAND_LOOK.knight.fill);
  resetIslandersWorkbenchCards();
});

test('left-clicking a held development card plays it instead of adding another copy', () => {
  resetIslandersWorkbenchCards();
  const region = { x: 0, y: 0, w: 140, h: 50 };
  adjustIslandersWorkbenchDev('knight', 1);
  const view = islandersWorkbenchView();
  const knight = islandersDevHandLandingCell(region, 'knight', false, view);
  const screen = new Screen(region.w, region.h);
  screen.setRoot(buildIslandersCardsOverlay(region, () => {}, view), region);

  screen.pointerDown(knight.col + 1, knight.row + 1);

  assert.equal(islandersWorkbenchView().devHand.knight, 0);
  assert.deepEqual(islandersWorkbenchDevelopmentPlay(), { type: 'knight', remaining: 1, resources: [] });
  resetIslandersWorkbenchCards();
});

test('the workbench controller turns a played knight into robber-targeting mode', () => {
  resetIslandersWorkbenchCards();
  adjustIslandersWorkbenchDev('knight', 1);
  const region = { x: 0, y: 0, w: 140, h: 50 };
  const screen = new Screen(region.w, region.h);
  const controller = new IslandersController({
    ui: screen,
    requestRender: () => {},
    requestFrame: () => {},
    shell: {
      renderMode: () => 'ascii',
      colorMode: () => 'truecolor',
      onHome: () => {},
      onCycleDisplay: () => {},
      onCycleColor: () => {},
      onControls: () => {},
      onQuit: () => {},
      menuValueColW: 10,
    },
  });
  controller.scene.setMode('boardCards');
  controller.scene.settle();
  const knight = islandersDevHandLandingCell(region, 'knight', false, islandersWorkbenchView());
  screen.setRoot(controller.buildRoot(region.w, region.h), region);

  screen.pointerDown(knight.col + 1, knight.row + 1);

  assert.equal(controller.scene.isMovingRobber(), true);
  assert.equal(islandersWorkbenchView().devHand.knight, 0);
  controller.reset();
  resetIslandersWorkbenchCards();
});

test('the workbench controller animates confirmed discards from the staged row into the bank', () => {
  resetIslandersWorkbenchCards();
  for (let i = 0; i < 5; i++) adjustIslandersWorkbenchHand('brick', 1);
  for (let i = 0; i < 4; i++) adjustIslandersWorkbenchHand('grain', 1);
  assert.equal(beginIslandersWorkbenchDiscard(), true);
  for (let i = 0; i < 3; i++) assert.equal(adjustIslandersWorkbenchDiscard('brick', 1), true);
  assert.equal(adjustIslandersWorkbenchDiscard('grain', 1), true);

  const region = { x: 0, y: 0, w: 140, h: 50 };
  const screen = new Screen(region.w, region.h);
  const controller = new IslandersController({
    ui: screen,
    requestRender: () => {},
    requestFrame: () => {},
    shell: {
      renderMode: () => 'ascii',
      colorMode: () => 'truecolor',
      onHome: () => {},
      onCycleDisplay: () => {},
      onCycleColor: () => {},
      onControls: () => {},
      onQuit: () => {},
      menuValueColW: 10,
    },
  });
  controller.scene.setMode('boardCards');
  controller.scene.settle();
  const before = islandersWorkbenchView();
  const bankBefore = { ...before.bank };
  screen.setRoot(controller.buildRoot(region.w, region.h), region);
  findNode(controller.buildRoot(region.w, region.h), 'islanders-discard-confirm')?.onClick?.();

  assert.equal(islandersWorkbenchDiscardOpen(), false, 'confirming closes the discard panel');
  assert.equal(controller.needsRender(), true, 'the controller keeps rendering while discarded cards fly');
  assert.equal(islandersWorkbenchView().hand.brick, 5, 'staged cards stay in hand until departure');
  assert.equal(islandersWorkbenchView().bank.brick, bankBefore.brick, 'the bank waits for each landing');

  const target = new RenderTarget(region.w, region.h * 2);
  controller.renderScene(target, 0);
  const flyingRoot = controller.buildRoot(region.w, region.h);
  const departure = islandersDiscardDepartureCell(region, 'brick');
  const projected = (function all(node: Node): Node[] {
    return [node, ...(node.children ?? []).flatMap(all)];
  })(flyingRoot).find((node) => node.style.left === departure.col - 2 && node.style.top === departure.row);
  assert.ok(projected, 'the first discarded card is drawn at its staged-row departure cell');

  for (let frame = 1; frame <= 28; frame++) controller.renderScene(target, frame * 0.25);
  assert.equal(controller.needsRender(), false);
  assert.equal(islandersWorkbenchView().hand.brick, 2);
  assert.equal(islandersWorkbenchView().hand.grain, 3);
  assert.equal(islandersWorkbenchView().bank.brick, bankBefore.brick + 3);
  assert.equal(islandersWorkbenchView().bank.grain, bankBefore.grain + 1);
  assert.equal(controller.scene.isMovingRobber(), true, 'robber choice starts after the cards land');
  controller.reset();
  resetIslandersWorkbenchCards();
});

test('the workbench waits for settled dice before opening discard or robber interaction', () => {
  resetIslandersWorkbenchCards();
  for (let i = 0; i < 8; i++) adjustIslandersWorkbenchHand('brick', 1);
  const region = { x: 0, y: 0, w: 140, h: 50 };
  const screen = new Screen(region.w, region.h);
  const controller = new IslandersController({
    ui: screen,
    requestRender: () => {},
    requestFrame: () => {},
    shell: {
      renderMode: () => 'ascii', colorMode: () => 'truecolor', onHome: () => {},
      onCycleDisplay: () => {}, onCycleColor: () => {}, onControls: () => {}, onQuit: () => {}, menuValueColW: 10,
    },
  });
  controller.scene.setMode('boardCards');
  controller.scene.settle();
  void controller.scene.rollDice([3, 4]);
  const dice = (controller.scene as unknown as { dice: [Die, Die] }).dice;
  dice[0].dur = 1;
  dice[1].dur = 1;
  const target = new RenderTarget(region.w, region.h * 2);
  const physicalLanding = DICE_STAGGER + DICE_ROLL_DUR;

  controller.renderScene(target, 0);
  controller.renderScene(target, physicalLanding);
  assert.equal(islandersWorkbenchDiscardOpen(), false, 'discard stays closed while final faces settle');
  assert.equal(controller.scene.isMovingRobber(), false);

  controller.renderScene(target, physicalLanding + DICE_RESULT_REVEAL_DELAY);
  assert.equal(islandersWorkbenchDiscardOpen(), true, 'the exact discard opens only after result publication');
  assert.equal(controller.scene.isMovingRobber(), false, 'robber selection waits for the required discard');
  controller.reset();
  resetIslandersWorkbenchCards();
});

test('workbench bank trade exchanges four matching cards for one bank card', () => {
  resetIslandersWorkbenchCards();
  for (let i = 0; i < 4; i++) assert.equal(adjustIslandersWorkbenchHand('brick', 1), true);
  for (let i = 0; i < 4; i++) assert.equal(adjustIslandersWorkbenchTradeStaging('give', 'brick', 1), true);
  assert.equal(adjustIslandersWorkbenchTradeStaging('receive', 'ore', 1), true);

  // Staging mirrors dragging cards into the two transfer rows: inventory is untouched until the
  // highlighted bank-trade action commits the complete 4:1 exchange.
  assert.equal(islandersWorkbenchView().hand.brick, 4);
  assert.equal(performStagedIslandersWorkbenchBankTrade(), true);
  const view = islandersWorkbenchView();
  assert.equal(view.hand.brick, 0);
  assert.equal(view.hand.ore, 1);
  assert.equal(view.bank.brick, 22);
  assert.equal(view.bank.ore, 16);
  assert.match(view.history.at(-1)?.message ?? '', /traded 4 brick for 1 ore/);
  resetIslandersWorkbenchCards();
});

test('animated maritime settlement moves offered and received cards at their own departure and landing boundaries', () => {
  resetIslandersWorkbenchCards();
  for (let i = 0; i < 8; i++) {
    adjustIslandersWorkbenchHand('brick', 1);
    adjustIslandersWorkbenchTradeStaging('give', 'brick', 1);
  }
  adjustIslandersWorkbenchTradeStaging('receive', 'ore', 2);

  const trade = beginStagedIslandersWorkbenchBankTrade();
  assert.deepEqual(trade, { give: 'brick', gets: ['ore', 'ore'], rate: 4 });
  let view = islandersWorkbenchView();
  assert.equal(view.hand.brick, 8, 'offered cards remain in hand until their individual departures');
  assert.equal(view.bank.brick, 18, 'offered cards do not reach the bank before landing');
  assert.equal(view.bank.ore, 17, 'incoming bank cards remain until their individual departures');
  assert.equal(view.hand.ore, 0, 'incoming cards are not credited before landing');

  assert.equal(departIslandersWorkbenchHandResource('brick'), true);
  view = islandersWorkbenchView();
  assert.equal(view.hand.brick, 7);
  assert.equal(view.bank.brick, 18);
  landIslandersWorkbenchBankResource('brick');
  assert.equal(islandersWorkbenchView().bank.brick, 19);

  for (let i = 0; i < 7; i++) {
    assert.equal(departIslandersWorkbenchHandResource('brick'), true);
    landIslandersWorkbenchBankResource('brick');
  }
  view = islandersWorkbenchView();
  assert.equal(view.hand.brick, 0);
  assert.equal(view.bank.brick, 26);

  assert.equal(departIslandersWorkbenchBankResource('ore'), true);
  view = islandersWorkbenchView();
  assert.equal(view.bank.ore, 16);
  assert.equal(view.hand.ore, 0);
  bankIslandersResource('ore');
  assert.equal(islandersWorkbenchView().hand.ore, 1);

  assert.equal(departIslandersWorkbenchBankResource('ore'), true);
  bankIslandersResource('ore');
  logIslandersWorkbenchMaritimeTrade(trade!, 'bank');
  view = islandersWorkbenchView();
  assert.equal(view.bank.ore, 15);
  assert.equal(view.hand.ore, 2);
  assert.match(view.history.at(-1)?.message ?? '', /traded 8 brick for 2 ore via bank/);
  resetIslandersWorkbenchCards();
});

test('Board + cards updates maritime rates after placement, upgrade, recolor, removal, and regeneration', () => {
  const board = generateBoard(mulberry32(0xc47a));
  const generic = board.harbors.find((harbor) => harbor.port.resource === null)!;
  const brick = board.harbors.find((harbor) => harbor.port.resource === 'brick')!;
  const scene = new TileScene();
  scene.adoptBoard(board, false);

  const defaultRates = { brick: 4, grain: 4, lumber: 4, ore: 4, wool: 4 } as const;
  assert.deepEqual(scene.maritimeTradeRates('red'), defaultRates);

  scene.placePiece('building', generic.nodes[0], 'red', false);
  assert.deepEqual(scene.maritimeTradeRates('red'), {
    brick: 3,
    grain: 3,
    lumber: 3,
    ore: 3,
    wool: 3,
  });

  scene.upgradeBuilding(generic.nodes[0]);
  assert.equal(scene.buildingInfo(generic.nodes[0])?.city, true);
  assert.equal(scene.maritimeTradeRates('red').ore, 3);

  scene.setBuildingColor(generic.nodes[0], 'blue');
  assert.deepEqual(scene.maritimeTradeRates('red'), defaultRates);
  assert.equal(scene.maritimeTradeRates('blue').ore, 3);

  scene.setBuildingColor(generic.nodes[0], 'red');
  scene.placePiece('building', brick.nodes[1], 'red', true);
  assert.deepEqual(scene.maritimePortTradeRates('red').brick, [2, 3]);
  scene.removeBuilding(brick.nodes[1]);
  scene.removeBuilding(generic.nodes[0]);
  assert.deepEqual(scene.maritimeTradeRates('red'), defaultRates);

  scene.placePiece('building', brick.nodes[1], 'red', true);
  assert.deepEqual(scene.maritimeTradeRates('red'), {
    brick: 2,
    grain: 4,
    lumber: 4,
    ore: 4,
    wool: 4,
  });

  scene.setMode('boardCards');
  scene.reroll();
  assert.deepEqual(scene.maritimeTradeRates('red'), defaultRates);
});

test('workbench port trade honors the applicable rate supplied by the board view', () => {
  resetIslandersWorkbenchCards();
  const ports = [{ ratio: 2, resource: 'brick' }] as const;
  const rates = maritimeTradeRates(ports);
  const portRates = maritimePortTradeRates(ports);
  for (let i = 0; i < 2; i++) {
    assert.equal(adjustIslandersWorkbenchHand('brick', 1), true);
    assert.equal(adjustIslandersWorkbenchTradeStaging('give', 'brick', 1), true);
  }
  assert.equal(adjustIslandersWorkbenchTradeStaging('receive', 'ore', 1), true);
  assert.equal(performStagedIslandersWorkbenchPortTrade(portRates), true);
  const view = islandersWorkbenchView(rates, portRates);
  assert.equal(view.hand.brick, 0);
  assert.equal(view.hand.ore, 1);
  assert.equal(view.maritimeRates.brick, 2);
  assert.match(view.history.at(-1)?.message ?? '', /traded 2 brick for 1 ore via port/);
  resetIslandersWorkbenchCards();
});

test('workbench ports batch rate multiples into mixed requested resources', () => {
  resetIslandersWorkbenchCards();
  const specificPorts = [{ ratio: 2, resource: 'grain' }] as const;
  const specificRates = maritimeTradeRates(specificPorts);
  const specificPortRates = maritimePortTradeRates(specificPorts);
  for (let i = 0; i < 4; i++) {
    adjustIslandersWorkbenchHand('grain', 1);
    adjustIslandersWorkbenchTradeStaging('give', 'grain', 1);
  }
  adjustIslandersWorkbenchTradeStaging('receive', 'lumber', 1);
  adjustIslandersWorkbenchTradeStaging('receive', 'ore', 1);
  assert.deepEqual(stagedIslandersPortTrade(specificPortRates), { give: 'grain', gets: ['lumber', 'ore'], rate: 2 });
  assert.equal(performStagedIslandersWorkbenchPortTrade(specificPortRates), true);
  let view = islandersWorkbenchView(specificRates, specificPortRates);
  assert.equal(view.hand.grain, 0);
  assert.equal(view.hand.lumber, 1);
  assert.equal(view.hand.ore, 1);
  assert.match(view.history.at(-1)?.message ?? '', /traded 4 wheat for 1 wood \+ 1 ore via port/);

  resetIslandersWorkbenchCards();
  const genericPorts = [{ ratio: 3, resource: null }] as const;
  const genericRates = maritimeTradeRates(genericPorts);
  const genericPortRates = maritimePortTradeRates(genericPorts);
  for (let i = 0; i < 6; i++) {
    adjustIslandersWorkbenchHand('wool', 1);
    adjustIslandersWorkbenchTradeStaging('give', 'wool', 1);
  }
  adjustIslandersWorkbenchTradeStaging('receive', 'brick', 1);
  adjustIslandersWorkbenchTradeStaging('receive', 'ore', 1);
  assert.deepEqual(stagedIslandersPortTrade(genericPortRates), { give: 'wool', gets: ['brick', 'ore'], rate: 3 });
  assert.equal(performStagedIslandersWorkbenchPortTrade(genericPortRates), true);
  view = islandersWorkbenchView(genericRates, genericPortRates);
  assert.equal(view.hand.wool, 0);
  assert.equal(view.hand.brick, 1);
  assert.equal(view.hand.ore, 1);
  assert.match(view.history.at(-1)?.message ?? '', /traded 6 sheep for 1 brick \+ 1 ore via port/);
  resetIslandersWorkbenchCards();
});

test('specific 2:1, generic 3:1, and bank 4:1 choices remain independently available', () => {
  const ports = [
    { ratio: 2, resource: 'grain' },
    { ratio: 3, resource: null },
  ] as const;
  const rates = maritimeTradeRates(ports);
  const portRates = maritimePortTradeRates(ports);
  assert.deepEqual(portRates.grain, [2, 3]);
  assert.equal(islandersWorkbenchView(rates, portRates).maritimeRates.grain, 2);

  for (const [giveCount, portRate, bankValid] of [
    [2, 2, false],
    [3, 3, false],
    [4, null, true],
  ] as const) {
    resetIslandersWorkbenchCards();
    for (let i = 0; i < giveCount; i++) {
      adjustIslandersWorkbenchHand('grain', 1);
      adjustIslandersWorkbenchTradeStaging('give', 'grain', 1);
    }
    adjustIslandersWorkbenchTradeStaging('receive', 'ore', 1);
    assert.equal(stagedIslandersPortTrade(portRates)?.rate ?? null, portRate);
    assert.equal(stagedIslandersBankTrade() !== null, bankValid);
  }
  resetIslandersWorkbenchCards();
});

test('workbench bank batches 8:2 and 12:3 exchanges', () => {
  resetIslandersWorkbenchCards();
  for (let i = 0; i < 8; i++) {
    adjustIslandersWorkbenchHand('brick', 1);
    adjustIslandersWorkbenchTradeStaging('give', 'brick', 1);
  }
  adjustIslandersWorkbenchTradeStaging('receive', 'lumber', 1);
  adjustIslandersWorkbenchTradeStaging('receive', 'ore', 1);
  assert.deepEqual(stagedIslandersBankTrade(), { give: 'brick', gets: ['lumber', 'ore'], rate: 4 });
  assert.equal(performStagedIslandersWorkbenchBankTrade(), true);
  let view = islandersWorkbenchView();
  assert.equal(view.hand.brick, 0);
  assert.equal(view.hand.lumber, 1);
  assert.equal(view.hand.ore, 1);

  resetIslandersWorkbenchCards();
  for (let i = 0; i < 12; i++) {
    adjustIslandersWorkbenchHand('grain', 1);
    adjustIslandersWorkbenchTradeStaging('give', 'grain', 1);
  }
  adjustIslandersWorkbenchTradeStaging('receive', 'lumber', 1);
  adjustIslandersWorkbenchTradeStaging('receive', 'wool', 2);
  assert.deepEqual(stagedIslandersBankTrade(), { give: 'grain', gets: ['lumber', 'wool', 'wool'], rate: 4 });
  assert.equal(performStagedIslandersWorkbenchBankTrade(), true);
  view = islandersWorkbenchView();
  assert.equal(view.hand.grain, 0);
  assert.equal(view.hand.lumber, 1);
  assert.equal(view.hand.wool, 2);
  assert.match(view.history.at(-1)?.message ?? '', /traded 12 wheat for 1 wood \+ 2 sheep via bank/);
  resetIslandersWorkbenchCards();
});

test('batched maritime trades require one requested card per complete ratio and exclude the offered resource', () => {
  resetIslandersWorkbenchCards();
  const rates = maritimePortTradeRates([{ ratio: 2, resource: 'grain' }]);
  for (let i = 0; i < 4; i++) {
    adjustIslandersWorkbenchHand('grain', 1);
    adjustIslandersWorkbenchTradeStaging('give', 'grain', 1);
  }
  adjustIslandersWorkbenchTradeStaging('receive', 'ore', 1);
  assert.equal(stagedIslandersPortTrade(rates), null);
  adjustIslandersWorkbenchTradeStaging('receive', 'grain', 1);
  assert.equal(stagedIslandersPortTrade(rates), null);
  adjustIslandersWorkbenchTradeStaging('receive', 'grain', -1);
  adjustIslandersWorkbenchTradeStaging('receive', 'brick', 1);
  assert.deepEqual(stagedIslandersPortTrade(rates), { give: 'grain', gets: ['brick', 'ore'], rate: 2 });
  resetIslandersWorkbenchCards();
});

test('workbench bank trade rejects short payments and identical resources', () => {
  resetIslandersWorkbenchCards();
  for (let i = 0; i < 3; i++) adjustIslandersWorkbenchHand('grain', 1);
  assert.equal(performIslandersWorkbenchBankTrade('grain', 'ore'), false);
  adjustIslandersWorkbenchHand('grain', 1);
  assert.equal(performIslandersWorkbenchBankTrade('grain', 'grain'), false);
  assert.equal(performIslandersWorkbenchPortTrade('grain', 'ore', maritimePortTradeRates([{ ratio: 2, resource: 'brick' }])), false);
  resetIslandersWorkbenchCards();
});

test('bank remains a separate fixed 4:1 option when the player owns a port', () => {
  const ports = [{ ratio: 2, resource: 'brick' }] as const;
  const rates = maritimeTradeRates(ports);
  const portRates = maritimePortTradeRates(ports);
  resetIslandersWorkbenchCards();
  for (let i = 0; i < 4; i++) {
    adjustIslandersWorkbenchHand('brick', 1);
    adjustIslandersWorkbenchTradeStaging('give', 'brick', 1);
  }
  adjustIslandersWorkbenchTradeStaging('receive', 'ore', 1);
  assert.deepEqual(stagedIslandersBankTrade(), { give: 'brick', gets: ['ore'], rate: 4 });
  assert.equal(stagedIslandersPortTrade(portRates), null);
  assert.equal(performStagedIslandersWorkbenchBankTrade(), true);
  const view = islandersWorkbenchView(rates, portRates);
  assert.equal(view.hand.brick, 0);
  assert.equal(view.hand.ore, 1);
  assert.match(view.history.at(-1)?.message ?? '', /traded 4 brick for 1 ore via bank/);
  resetIslandersWorkbenchCards();
});

test('staged port trade rejects missing ports, insufficient payments, and excessive payments', () => {
  const rates = maritimePortTradeRates([{ ratio: 3, resource: null }]);
  resetIslandersWorkbenchCards();
  for (let i = 0; i < 4; i++) adjustIslandersWorkbenchHand('grain', 1);
  for (let i = 0; i < 2; i++) adjustIslandersWorkbenchTradeStaging('give', 'grain', 1);
  adjustIslandersWorkbenchTradeStaging('receive', 'ore', 1);
  assert.equal(stagedIslandersPortTrade(maritimePortTradeRates([])), null);
  assert.equal(stagedIslandersPortTrade(rates), null);
  assert.equal(performStagedIslandersWorkbenchPortTrade(rates), false);

  adjustIslandersWorkbenchTradeStaging('give', 'grain', 1);
  assert.deepEqual(stagedIslandersPortTrade(rates), { give: 'grain', gets: ['ore'], rate: 3 });
  adjustIslandersWorkbenchTradeStaging('give', 'grain', 1);
  assert.equal(stagedIslandersPortTrade(rates), null);
  assert.equal(performStagedIslandersWorkbenchPortTrade(rates), false);
  resetIslandersWorkbenchCards();
});

test('workbench bank trade cannot request an unavailable bank resource', () => {
  resetIslandersWorkbenchCards();
  for (let i = 0; i < 17 * 4 + 4; i++) adjustIslandersWorkbenchHand('brick', 1);
  for (let i = 0; i < 4; i++) adjustIslandersWorkbenchTradeStaging('give', 'brick', 1);
  adjustIslandersWorkbenchTradeStaging('receive', 'ore', 1);
  for (let i = 0; i < 17; i++) assert.equal(performIslandersWorkbenchBankTrade('brick', 'ore'), true);
  assert.equal(islandersWorkbenchView().bank.ore, 0);
  assert.equal(stagedIslandersBankTrade(), null);
  assert.equal(performStagedIslandersWorkbenchBankTrade(), false);
  resetIslandersWorkbenchCards();
});

test('staged bank trade rejects mixed give cards and supports moving one card back', () => {
  resetIslandersWorkbenchCards();
  for (let i = 0; i < 2; i++) {
    adjustIslandersWorkbenchHand('brick', 1);
    adjustIslandersWorkbenchHand('grain', 1);
    adjustIslandersWorkbenchTradeStaging('give', 'brick', 1);
    adjustIslandersWorkbenchTradeStaging('give', 'grain', 1);
  }
  adjustIslandersWorkbenchTradeStaging('receive', 'ore', 1);
  assert.equal(performStagedIslandersWorkbenchBankTrade(), false);
  assert.equal(adjustIslandersWorkbenchTradeStaging('give', 'grain', -1), true);
  assert.equal(islandersWorkbenchView().hand.grain, 2);
  resetIslandersWorkbenchCards();
});

test('workbench player trade waits for every opponent and can complete an accepted offer', () => {
  resetIslandersWorkbenchCards();
  adjustIslandersWorkbenchHand('brick', 1);
  adjustIslandersWorkbenchTradeStaging('give', 'brick', 1);
  adjustIslandersWorkbenchTradeStaging('receive', 'wool', 1);
  const view = islandersWorkbenchView();
  const id = createIslandersWorkbenchPlayerTrade(view.localPlayer, view.opponents, () => {});
  assert.equal(id, 1);
  const pending = islandersWorkbenchPlayerTradeOffers()[0];
  assert.equal(pending.reactions.length, view.opponents.length);
  assert.deepEqual(pending.reactions.map((reaction) => reaction.status), ['pending', 'pending', 'pending']);

  assert.equal(resolveIslandersWorkbenchPlayerTradeOffer(id!), true);
  const decided = islandersWorkbenchPlayerTradeOffers()[0];
  assert.deepEqual(decided.reactions.map((reaction) => reaction.status), ['accepted', 'rejected', 'rejected']);
  assert.equal(completeIslandersWorkbenchPlayerTrade(id!, decided.reactions[0].player.name), true);
  assert.equal(islandersWorkbenchPlayerTradeOffers().length, 0);
  assert.equal(islandersWorkbenchView().hand.brick, 0);
  assert.equal(islandersWorkbenchView().hand.wool, 1);
  resetIslandersWorkbenchCards();
});

test('workbench player trade can be cancelled while reactions are pending', () => {
  resetIslandersWorkbenchCards();
  adjustIslandersWorkbenchHand('grain', 1);
  adjustIslandersWorkbenchTradeStaging('give', 'grain', 1);
  adjustIslandersWorkbenchTradeStaging('receive', 'ore', 1);
  const view = islandersWorkbenchView();
  const id = createIslandersWorkbenchPlayerTrade(view.localPlayer, view.opponents, () => {});
  assert.notEqual(id, null);
  assert.equal(cancelIslandersWorkbenchPlayerTrade(id!), true);
  assert.equal(islandersWorkbenchPlayerTradeOffers().length, 0);
  assert.equal(islandersWorkbenchView().hand.grain, 1);
  resetIslandersWorkbenchCards();
});

test('player trade popup uses a fixed color-square identity and spaces arrows from resources', () => {
  const view = islandersWorkbenchView();
  const controller: IslandersPlayerTradeOffersController = {
    offers: [{
      id: 99,
      offerer: { ...view.localPlayer, name: 'grok-4.1-fast-non-reasoning' },
      give: { lumber: 0, brick: 1, wool: 0, grain: 0, ore: 0 },
      get: { lumber: 0, brick: 0, wool: 0, grain: 1, ore: 0 },
      reactions: [],
    }],
  };
  const root = buildIslandersCardsOverlay(
    { x: 0, y: 0, w: 140, h: 50 },
    () => {},
    view,
    () => {},
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    controller,
  );
  const nodes: Node[] = [];
  const visit = (node: Node): void => {
    nodes.push(node);
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  assert.equal(nodes.some((node) => node.text === 'grok-4.1-fast-non-reasoning'), false);
  const identity = nodes.find((node) => node.text === '■');
  assert.ok(identity);
  const arrow = nodes.find((node) => node.text === '↑');
  assert.ok(arrow);
  const exchangeRow = nodes.find((node) => node.children?.includes(arrow) === false
    && node.children?.some((child) => child.children?.includes(arrow))
    && node.style.gap === 1);
  assert.ok(exchangeRow, 'exchange row reserves one cell between its identity arrow and resources');
});

test('workbench development purchase spends the official cost and draws a card', () => {
  resetIslandersWorkbenchCards();
  adjustIslandersWorkbenchHand('ore', 1);
  adjustIslandersWorkbenchHand('wool', 1);
  adjustIslandersWorkbenchHand('grain', 1);

  assert.equal(buyIslandersWorkbenchDevCard(), true);
  const view = islandersWorkbenchView();
  assert.equal(view.hand.ore, 0);
  assert.equal(view.hand.wool, 0);
  assert.equal(view.hand.grain, 0);
  assert.equal(view.developmentDeck, 24);
  assert.equal(Object.values(view.devHand).reduce((sum, count) => sum + count, 0), 1);
  assert.match(view.history.at(-1)?.message ?? '', /bought a development card/);
  resetIslandersWorkbenchCards();
});

test('animated development purchase debits the deck at departure and reveals the card at landing', () => {
  resetIslandersWorkbenchCards();
  adjustIslandersWorkbenchHand('ore', 1);
  adjustIslandersWorkbenchHand('wool', 1);
  adjustIslandersWorkbenchHand('grain', 1);

  const drawn = beginIslandersWorkbenchDevPurchase();
  assert.notEqual(drawn, null);
  let view = islandersWorkbenchView();
  assert.equal(view.hand.ore, 0);
  assert.equal(view.hand.wool, 0);
  assert.equal(view.hand.grain, 0);
  assert.equal(view.developmentDeck, 25, 'the pile remains unchanged until the card launches');
  assert.equal(Object.values(view.devHand).reduce((sum, count) => sum + count, 0), 0);

  assert.equal(departIslandersWorkbenchDevCard(drawn!), true);
  view = islandersWorkbenchView();
  assert.equal(view.developmentDeck, 24);
  assert.equal(Object.values(view.devHand).reduce((sum, count) => sum + count, 0), 0);

  landIslandersWorkbenchDevCard(drawn!);
  logIslandersWorkbenchDevPurchase();
  view = islandersWorkbenchView();
  assert.equal(view.devHand[drawn!], 1);
  assert.match(view.history.at(-1)?.message ?? '', /bought a development card/);
  resetIslandersWorkbenchCards();
});

test('development purchases reserve distinct deck cards while earlier cards are still flying', () => {
  resetIslandersWorkbenchCards();
  for (let purchase = 0; purchase < 2; purchase++) {
    adjustIslandersWorkbenchHand('ore', 1);
    adjustIslandersWorkbenchHand('wool', 1);
    adjustIslandersWorkbenchHand('grain', 1);
  }

  const first = beginIslandersWorkbenchDevPurchase();
  const second = beginIslandersWorkbenchDevPurchase();
  assert.notEqual(first, null);
  assert.notEqual(second, null);
  assert.equal(islandersWorkbenchView().developmentDeck, 25, 'reserved cards remain visible on the pile until launch');

  assert.equal(departIslandersWorkbenchDevCard(first!), true);
  assert.equal(islandersWorkbenchView().developmentDeck, 24);
  assert.equal(departIslandersWorkbenchDevCard(second!), true);
  assert.equal(islandersWorkbenchView().developmentDeck, 23);
  landIslandersWorkbenchDevCard(first!);
  landIslandersWorkbenchDevCard(second!);
  assert.equal(Object.values(islandersWorkbenchView().devHand).reduce((sum, count) => sum + count, 0), 2);
  resetIslandersWorkbenchCards();
});

test('an in-flight development purchase leaves trade and another purchase enabled', () => {
  resetIslandersWorkbenchCards();
  for (let purchase = 0; purchase < 2; purchase++) {
    adjustIslandersWorkbenchHand('ore', 1);
    adjustIslandersWorkbenchHand('wool', 1);
    adjustIslandersWorkbenchHand('grain', 1);
  }
  adjustIslandersWorkbenchHand('brick', 4);
  const region = { x: 0, y: 0, w: 180, h: 60 };
  const screen = new Screen(region.w, region.h);
  const controller = new IslandersController({
    ui: screen,
    requestRender: () => {},
    requestFrame: () => {},
    shell: {
      renderMode: () => 'ascii',
      colorMode: () => 'truecolor',
      onHome: () => {},
      onCycleDisplay: () => {},
      onCycleColor: () => {},
      onControls: () => {},
      onQuit: () => {},
      menuValueColW: 10,
    },
  });
  controller.scene.setMode('boardCards');
  controller.scene.settle();

  let root = controller.buildRoot(region.w, region.h);
  const firstBuy = findNode(root, 'islanders-buy-dev');
  assert.equal(firstBuy?.disabled, false);
  firstBuy?.onClick?.();

  root = controller.buildRoot(region.w, region.h);
  const trade = findNode(root, 'islanders-trade-open');
  const secondBuy = findNode(root, 'islanders-buy-dev');
  assert.equal(trade?.disabled, false, 'trade remains available during the card flight');
  assert.equal(secondBuy?.disabled, false, 'another purchase remains available during the card flight');
  secondBuy?.onClick?.();
  assert.equal(islandersWorkbenchView().hand.ore, 0, 'both queued purchases commit their costs');

  controller.reset();
  resetIslandersWorkbenchCards();
});

test('workbench development cards play from the paid hand while victory points remain passive', () => {
  resetIslandersWorkbenchCards();
  adjustIslandersWorkbenchDev('knight', 1);
  adjustIslandersWorkbenchDev('roadBuilding', 1);
  adjustIslandersWorkbenchDev('victoryPoint', 1);

  assert.equal(beginIslandersWorkbenchDevelopmentPlay('victoryPoint'), false);
  assert.equal(islandersWorkbenchView().devHand.victoryPoint, 1);

  assert.equal(beginIslandersWorkbenchDevelopmentPlay('knight'), true);
  assert.deepEqual(islandersWorkbenchDevelopmentPlay(), { type: 'knight', remaining: 1, resources: [] });
  assert.equal(islandersWorkbenchView().devHand.knight, 0);
  assert.equal(islandersWorkbenchView().localPlayer.knights, 3);
  assert.equal(completeIslandersWorkbenchDevelopmentStep('knight'), true);
  assert.equal(islandersWorkbenchDevelopmentPlay(), null);

  assert.equal(beginIslandersWorkbenchDevelopmentPlay('roadBuilding'), true);
  assert.equal(completeIslandersWorkbenchDevelopmentStep('roadBuilding'), true);
  assert.deepEqual(islandersWorkbenchDevelopmentPlay(), { type: 'roadBuilding', remaining: 1, resources: [] });
  assert.equal(completeIslandersWorkbenchDevelopmentStep('roadBuilding'), true);
  assert.equal(islandersWorkbenchDevelopmentPlay(), null);
  assert.match(islandersWorkbenchView().history.at(-1)?.message ?? '', /played road building/);
  resetIslandersWorkbenchCards();
});

test('workbench year of plenty draws from the bank and monopoly records its named resource', () => {
  resetIslandersWorkbenchCards();
  adjustIslandersWorkbenchDev('yearOfPlenty', 1);
  adjustIslandersWorkbenchDev('monopoly', 1);

  const oreBefore = islandersWorkbenchView().bank.ore;
  assert.equal(beginIslandersWorkbenchDevelopmentPlay('yearOfPlenty'), true);
  assert.equal(chooseIslandersWorkbenchDevelopmentResource('ore'), true);
  assert.equal(chooseIslandersWorkbenchDevelopmentResource('ore'), true);
  let view = islandersWorkbenchView();
  assert.equal(view.hand.ore, 2);
  assert.equal(view.bank.ore, oreBefore - 2);
  assert.equal(view.developmentPlay, undefined);
  assert.deepEqual(view.history.at(-1)?.resources, ['ore', 'ore']);

  assert.equal(beginIslandersWorkbenchDevelopmentPlay('monopoly'), true);
  assert.equal(chooseIslandersWorkbenchDevelopmentResource('grain'), true);
  view = islandersWorkbenchView();
  assert.equal(view.developmentPlay, undefined);
  assert.match(view.history.at(-1)?.message ?? '', /named wheat for monopoly/);
  resetIslandersWorkbenchCards();
});

test('workbench development purchases exhaust the official uneven 25-card deck', () => {
  resetIslandersWorkbenchCards();
  for (let i = 0; i < 25; i++) {
    adjustIslandersWorkbenchHand('ore', 1);
    adjustIslandersWorkbenchHand('wool', 1);
    adjustIslandersWorkbenchHand('grain', 1);
    assert.equal(buyIslandersWorkbenchDevCard(), true);
  }

  const view = islandersWorkbenchView();
  assert.equal(view.developmentDeck, 0);
  assert.deepEqual(view.devHand, DEV_CARD_COUNTS);
  adjustIslandersWorkbenchHand('ore', 1);
  adjustIslandersWorkbenchHand('wool', 1);
  adjustIslandersWorkbenchHand('grain', 1);
  assert.equal(buyIslandersWorkbenchDevCard(), false);
  resetIslandersWorkbenchCards();
});

test('workbench reset restores the complete bank and development deck', () => {
  resetIslandersWorkbenchCards();
  adjustIslandersWorkbenchHand('ore', 1);
  adjustIslandersWorkbenchHand('wool', 1);
  adjustIslandersWorkbenchHand('grain', 1);
  assert.equal(buyIslandersWorkbenchDevCard(), true);

  const bought = islandersWorkbenchView();
  assert.equal(bought.developmentDeck, 24);
  assert.equal(Object.values(bought.devHand).reduce((sum, count) => sum + count, 0), 1);

  resetIslandersWorkbenchCards();
  const reset = islandersWorkbenchView();
  assert.equal(reset.developmentDeck, 25);
  assert.deepEqual(reset.devHand, {
    knight: 0,
    victoryPoint: 0,
    roadBuilding: 0,
    yearOfPlenty: 0,
    monopoly: 0,
  });
  assert.deepEqual(reset.bank, { lumber: 16, brick: 18, wool: 17, grain: 18, ore: 17 });
  assert.deepEqual(reset.hand, { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 });
});
