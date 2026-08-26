// Scene-level only. The card HUD's presentation (labels, casing, glyphs, widths, which stats
// show) is in fast visual iteration and is deliberately NOT asserted here — those tests break
// every turn and cost more than they catch. Verify the UI with `pnpm snapshot ... board-cards hud`
// and look at the PNG instead.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mulberry32, RenderTarget } from '../../../engine/index.ts';
import { type Node, Screen } from '../../../tui/index.ts';
import { maritimePortTradeRates, maritimeTradeRates } from '../../../rules/catan/maritime-trade.ts';
import { generateBoard } from '../../../rules/catan/setup.ts';
import { DEV_CARD_COUNTS } from '../../../rules/catan/types.ts';
import {
  adjustCatanWorkbenchDiscard,
  adjustCatanWorkbenchDev,
  adjustCatanWorkbenchHand,
  adjustCatanWorkbenchTradeStaging,
  bankCatanResource,
  beginCatanWorkbenchDiscard,
  beginCatanWorkbenchDevelopmentPlay,
  beginCatanWorkbenchDevPurchase,
  beginStagedCatanWorkbenchBankTrade,
  buildCatanCardsOverlay,
  buyCatanWorkbenchDevCard,
  canSubmitCatanWorkbenchDiscard,
  cancelCatanWorkbenchPlayerTrade,
  catanWorkbenchPlayerTradeOffers,
  catanBankDepartureCell,
  catanDevDeckDepartureCell,
  catanDevHandLandingCell,
  catanHandLandingCell,
  catanHistoryRows,
  catanWorkbenchDiscardOpen,
  catanWorkbenchDiscardRequired,
  catanWorkbenchDevelopmentPlay,
  catanWorkbenchView,
  type CatanTradeEditorController,
  type CatanPlayerTradeOffersController,
  chooseCatanWorkbenchDevelopmentResource,
  completeCatanWorkbenchDevelopmentStep,
  completeCatanWorkbenchPlayerTrade,
  createCatanWorkbenchPlayerTrade,
  departCatanWorkbenchBankResource,
  departCatanWorkbenchHandResource,
  departCatanWorkbenchDevCard,
  landCatanWorkbenchBankResource,
  landCatanWorkbenchDevCard,
  logCatanWorkbenchDevPurchase,
  logCatanWorkbenchMaritimeTrade,
  performCatanWorkbenchBankTrade,
  performCatanWorkbenchPortTrade,
  performStagedCatanWorkbenchBankTrade,
  performStagedCatanWorkbenchPortTrade,
  resetCatanWorkbenchCards,
  resolveCatanWorkbenchPlayerTradeOffer,
  setCatanTradeEditorOpen,
  submitCatanWorkbenchDiscard,
} from './card-hud.ts';
import { stagedCatanBankTrade, stagedCatanPortTrade } from './card-workbench.ts';
import { CatanController } from './catan-controller.ts';
import { CATAN_CARD, DEV_HAND_LOOK } from './palette.ts';
import { TileScene } from './tile-scene.ts';

function findNode(node: Node, id: string): Node | undefined {
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return undefined;
}

test('Catan action history wraps complete model commentary onto physical continuation rows', () => {
  const message = 'I am attempting to trade for ore because my production portfolio is weak there and the city timing matters.';
  const rows = catanHistoryRows({ actor: 'grok-4.1-fast-non-reasoning', color: 'red', message, chat: true });
  assert.ok(rows.length > 2);
  const painted = rows.flatMap((row) => row.children?.map((child) => child.text ?? '') ?? [row.text ?? '']).join(' ');
  for (const word of message.split(' ')) assert.ok(painted.includes(word), `missing wrapped word: ${word}`);
});

test('the workbench opens the shared discard row only above seven cards and returns selected cards to the bank', () => {
  resetCatanWorkbenchCards();
  for (let i = 0; i < 5; i++) adjustCatanWorkbenchHand('brick', 1);
  for (let i = 0; i < 4; i++) adjustCatanWorkbenchHand('grain', 1);
  const bankBefore = { ...catanWorkbenchView().bank };

  assert.equal(beginCatanWorkbenchDiscard(), true);
  assert.equal(catanWorkbenchDiscardOpen(), true);
  assert.equal(catanWorkbenchDiscardRequired(), 4);
  const root = buildCatanCardsOverlay({ x: 0, y: 0, w: 140, h: 50 }, () => {});
  assert.equal(findNode(root, 'catan-discard-confirm')?.disabled, true);

  for (let i = 0; i < 3; i++) assert.equal(adjustCatanWorkbenchDiscard('brick', 1), true);
  assert.equal(adjustCatanWorkbenchDiscard('grain', 1), true);
  assert.equal(canSubmitCatanWorkbenchDiscard(), true);
  assert.equal(submitCatanWorkbenchDiscard(), true);
  assert.equal(catanWorkbenchDiscardOpen(), false);
  assert.equal(catanWorkbenchView().hand.brick, 2);
  assert.equal(catanWorkbenchView().hand.grain, 3);
  assert.equal(catanWorkbenchView().bank.brick, bankBefore.brick + 3);
  assert.equal(catanWorkbenchView().bank.grain, bankBefore.grain + 1);

  resetCatanWorkbenchCards();
  for (let i = 0; i < 7; i++) adjustCatanWorkbenchHand('wool', 1);
  assert.equal(beginCatanWorkbenchDiscard(), false);
  resetCatanWorkbenchCards();
});

test('the full four-row trade editor is shared by live Catan rather than limited to the workbench', () => {
  const view = catanWorkbenchView();
  view.source = 'live';
  const counts = { brick: 0, grain: 0, lumber: 0, ore: 0, wool: 0 };
  const controller: CatanTradeEditorController = {
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
  const root = buildCatanCardsOverlay(
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

  assert.equal(findNode(root, 'catan-trade-confirm')?.disabled, false);
  assert.equal(findNode(root, 'catan-port-trade-confirm')?.disabled, true);
  assert.equal(findNode(root, 'catan-player-trade')?.disabled, false);
  assert.ok(findNode(root, 'catan-trade-close'));
});

test('a playable live development card submits through its hand card while VP remains passive', () => {
  const view = catanWorkbenchView();
  view.source = 'live';
  view.devHand.knight = 1;
  view.devHand.victoryPoint = 1;
  view.playableDevelopmentCards = ['knight'];
  let played = '';
  const root = buildCatanCardsOverlay(
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
  const knight = findNode(root, 'catan-dev-knight');
  assert.ok(knight?.onMouse);
  assert.equal(knight.onMouse({ type: 'down', x: 0, y: 0, w: 7, h: 6, button: 0 }), true);
  assert.equal(played, 'knight');
  assert.equal(findNode(root, 'catan-dev-victoryPoint')?.onMouse, undefined);
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
  assert.deepEqual(catanHandLandingCell({ x: 0, y: 0, w: 140, h: 50 }, 'lumber'), { col: 7, row: 44 });
});

test('trade flights leave the visible bank card or the hidden right edge at the same height', () => {
  const region = { x: 0, y: 0, w: 140, h: 50 };
  assert.deepEqual(catanBankDepartureCell(region, 'ore', 4, true), { col: 126, row: 34 });
  assert.deepEqual(catanBankDepartureCell(region, 'ore', 4, false), { col: 143, row: 33 });
});

test('development flights leave the dev pile and land on a responsive dev-hand slot', () => {
  const region = { x: 0, y: 0, w: 140, h: 50 };
  const view = catanWorkbenchView();
  assert.equal(view.source, 'workbench');
  view.pendingDevelopmentCards = ['knight'];
  assert.deepEqual(catanDevDeckDepartureCell(region, 4, true), { col: 134, row: 34 });
  assert.deepEqual(catanDevDeckDepartureCell(region, 4, false), { col: 143, row: 33 });
  assert.deepEqual(catanDevHandLandingCell(region, 'knight', true, view), { col: 49, row: 44 });
  assert.deepEqual(catanDevHandLandingCell(region, 'knight', false, view), { col: 49, row: 44 });
});

test('a development landing slot stays disabled until the card arrives', () => {
  resetCatanWorkbenchCards();
  setCatanTradeEditorOpen(false);
  const region = { x: 0, y: 0, w: 100, h: 50 };
  const view = catanWorkbenchView();
  view.developmentPurchaseBusy = true;
  view.pendingDevelopmentCards = ['knight'];
  const landing = catanDevHandLandingCell(region, 'knight', false, view);
  const screen = new Screen(region.w, region.h);

  screen.setRoot(buildCatanCardsOverlay(region, () => {}, view), region);
  const pending = screen.snapshot(() => {});
  assert.deepEqual(pending.getCell(landing.col, landing.row)?.bg, CATAN_CARD.emptyFill);

  view.devHand.knight = 1;
  view.developmentPurchaseBusy = false;
  delete view.pendingDevelopmentCards;
  screen.setRoot(buildCatanCardsOverlay(region, () => {}, view), region);
  const landed = screen.snapshot(() => {});
  assert.deepEqual(landed.getCell(landing.col, landing.row)?.bg, DEV_HAND_LOOK.knight.fill);
  resetCatanWorkbenchCards();
});

test('left-clicking a held development card plays it instead of adding another copy', () => {
  resetCatanWorkbenchCards();
  const region = { x: 0, y: 0, w: 140, h: 50 };
  adjustCatanWorkbenchDev('knight', 1);
  const view = catanWorkbenchView();
  const knight = catanDevHandLandingCell(region, 'knight', false, view);
  const screen = new Screen(region.w, region.h);
  screen.setRoot(buildCatanCardsOverlay(region, () => {}, view), region);

  screen.pointerDown(knight.col + 1, knight.row + 1);

  assert.equal(catanWorkbenchView().devHand.knight, 0);
  assert.deepEqual(catanWorkbenchDevelopmentPlay(), { type: 'knight', remaining: 1, resources: [] });
  resetCatanWorkbenchCards();
});

test('the workbench controller turns a played knight into robber-targeting mode', () => {
  resetCatanWorkbenchCards();
  adjustCatanWorkbenchDev('knight', 1);
  const region = { x: 0, y: 0, w: 140, h: 50 };
  const screen = new Screen(region.w, region.h);
  const controller = new CatanController({
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
  const knight = catanDevHandLandingCell(region, 'knight', false, catanWorkbenchView());
  screen.setRoot(controller.buildRoot(region.w, region.h), region);

  screen.pointerDown(knight.col + 1, knight.row + 1);

  assert.equal(controller.scene.isMovingRobber(), true);
  assert.equal(catanWorkbenchView().devHand.knight, 0);
  controller.reset();
  resetCatanWorkbenchCards();
});

test('workbench bank trade exchanges four matching cards for one bank card', () => {
  resetCatanWorkbenchCards();
  for (let i = 0; i < 4; i++) assert.equal(adjustCatanWorkbenchHand('brick', 1), true);
  for (let i = 0; i < 4; i++) assert.equal(adjustCatanWorkbenchTradeStaging('give', 'brick', 1), true);
  assert.equal(adjustCatanWorkbenchTradeStaging('receive', 'ore', 1), true);

  // Staging mirrors dragging cards into the two transfer rows: inventory is untouched until the
  // highlighted bank-trade action commits the complete 4:1 exchange.
  assert.equal(catanWorkbenchView().hand.brick, 4);
  assert.equal(performStagedCatanWorkbenchBankTrade(), true);
  const view = catanWorkbenchView();
  assert.equal(view.hand.brick, 0);
  assert.equal(view.hand.ore, 1);
  assert.equal(view.bank.brick, 22);
  assert.equal(view.bank.ore, 16);
  assert.match(view.history.at(-1)?.message ?? '', /traded 4 brick for 1 ore/);
  resetCatanWorkbenchCards();
});

test('animated maritime settlement moves offered and received cards at their own departure and landing boundaries', () => {
  resetCatanWorkbenchCards();
  for (let i = 0; i < 8; i++) {
    adjustCatanWorkbenchHand('brick', 1);
    adjustCatanWorkbenchTradeStaging('give', 'brick', 1);
  }
  adjustCatanWorkbenchTradeStaging('receive', 'ore', 2);

  const trade = beginStagedCatanWorkbenchBankTrade();
  assert.deepEqual(trade, { give: 'brick', gets: ['ore', 'ore'], rate: 4 });
  let view = catanWorkbenchView();
  assert.equal(view.hand.brick, 8, 'offered cards remain in hand until their individual departures');
  assert.equal(view.bank.brick, 18, 'offered cards do not reach the bank before landing');
  assert.equal(view.bank.ore, 17, 'incoming bank cards remain until their individual departures');
  assert.equal(view.hand.ore, 0, 'incoming cards are not credited before landing');

  assert.equal(departCatanWorkbenchHandResource('brick'), true);
  view = catanWorkbenchView();
  assert.equal(view.hand.brick, 7);
  assert.equal(view.bank.brick, 18);
  landCatanWorkbenchBankResource('brick');
  assert.equal(catanWorkbenchView().bank.brick, 19);

  for (let i = 0; i < 7; i++) {
    assert.equal(departCatanWorkbenchHandResource('brick'), true);
    landCatanWorkbenchBankResource('brick');
  }
  view = catanWorkbenchView();
  assert.equal(view.hand.brick, 0);
  assert.equal(view.bank.brick, 26);

  assert.equal(departCatanWorkbenchBankResource('ore'), true);
  view = catanWorkbenchView();
  assert.equal(view.bank.ore, 16);
  assert.equal(view.hand.ore, 0);
  bankCatanResource('ore');
  assert.equal(catanWorkbenchView().hand.ore, 1);

  assert.equal(departCatanWorkbenchBankResource('ore'), true);
  bankCatanResource('ore');
  logCatanWorkbenchMaritimeTrade(trade!, 'bank');
  view = catanWorkbenchView();
  assert.equal(view.bank.ore, 15);
  assert.equal(view.hand.ore, 2);
  assert.match(view.history.at(-1)?.message ?? '', /traded 8 brick for 2 ore via bank/);
  resetCatanWorkbenchCards();
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
  resetCatanWorkbenchCards();
  const ports = [{ ratio: 2, resource: 'brick' }] as const;
  const rates = maritimeTradeRates(ports);
  const portRates = maritimePortTradeRates(ports);
  for (let i = 0; i < 2; i++) {
    assert.equal(adjustCatanWorkbenchHand('brick', 1), true);
    assert.equal(adjustCatanWorkbenchTradeStaging('give', 'brick', 1), true);
  }
  assert.equal(adjustCatanWorkbenchTradeStaging('receive', 'ore', 1), true);
  assert.equal(performStagedCatanWorkbenchPortTrade(portRates), true);
  const view = catanWorkbenchView(rates, portRates);
  assert.equal(view.hand.brick, 0);
  assert.equal(view.hand.ore, 1);
  assert.equal(view.maritimeRates.brick, 2);
  assert.match(view.history.at(-1)?.message ?? '', /traded 2 brick for 1 ore via port/);
  resetCatanWorkbenchCards();
});

test('workbench ports batch rate multiples into mixed requested resources', () => {
  resetCatanWorkbenchCards();
  const specificPorts = [{ ratio: 2, resource: 'grain' }] as const;
  const specificRates = maritimeTradeRates(specificPorts);
  const specificPortRates = maritimePortTradeRates(specificPorts);
  for (let i = 0; i < 4; i++) {
    adjustCatanWorkbenchHand('grain', 1);
    adjustCatanWorkbenchTradeStaging('give', 'grain', 1);
  }
  adjustCatanWorkbenchTradeStaging('receive', 'lumber', 1);
  adjustCatanWorkbenchTradeStaging('receive', 'ore', 1);
  assert.deepEqual(stagedCatanPortTrade(specificPortRates), { give: 'grain', gets: ['lumber', 'ore'], rate: 2 });
  assert.equal(performStagedCatanWorkbenchPortTrade(specificPortRates), true);
  let view = catanWorkbenchView(specificRates, specificPortRates);
  assert.equal(view.hand.grain, 0);
  assert.equal(view.hand.lumber, 1);
  assert.equal(view.hand.ore, 1);
  assert.match(view.history.at(-1)?.message ?? '', /traded 4 wheat for 1 wood \+ 1 ore via port/);

  resetCatanWorkbenchCards();
  const genericPorts = [{ ratio: 3, resource: null }] as const;
  const genericRates = maritimeTradeRates(genericPorts);
  const genericPortRates = maritimePortTradeRates(genericPorts);
  for (let i = 0; i < 6; i++) {
    adjustCatanWorkbenchHand('wool', 1);
    adjustCatanWorkbenchTradeStaging('give', 'wool', 1);
  }
  adjustCatanWorkbenchTradeStaging('receive', 'brick', 1);
  adjustCatanWorkbenchTradeStaging('receive', 'ore', 1);
  assert.deepEqual(stagedCatanPortTrade(genericPortRates), { give: 'wool', gets: ['brick', 'ore'], rate: 3 });
  assert.equal(performStagedCatanWorkbenchPortTrade(genericPortRates), true);
  view = catanWorkbenchView(genericRates, genericPortRates);
  assert.equal(view.hand.wool, 0);
  assert.equal(view.hand.brick, 1);
  assert.equal(view.hand.ore, 1);
  assert.match(view.history.at(-1)?.message ?? '', /traded 6 sheep for 1 brick \+ 1 ore via port/);
  resetCatanWorkbenchCards();
});

test('specific 2:1, generic 3:1, and bank 4:1 choices remain independently available', () => {
  const ports = [
    { ratio: 2, resource: 'grain' },
    { ratio: 3, resource: null },
  ] as const;
  const rates = maritimeTradeRates(ports);
  const portRates = maritimePortTradeRates(ports);
  assert.deepEqual(portRates.grain, [2, 3]);
  assert.equal(catanWorkbenchView(rates, portRates).maritimeRates.grain, 2);

  for (const [giveCount, portRate, bankValid] of [
    [2, 2, false],
    [3, 3, false],
    [4, null, true],
  ] as const) {
    resetCatanWorkbenchCards();
    for (let i = 0; i < giveCount; i++) {
      adjustCatanWorkbenchHand('grain', 1);
      adjustCatanWorkbenchTradeStaging('give', 'grain', 1);
    }
    adjustCatanWorkbenchTradeStaging('receive', 'ore', 1);
    assert.equal(stagedCatanPortTrade(portRates)?.rate ?? null, portRate);
    assert.equal(stagedCatanBankTrade() !== null, bankValid);
  }
  resetCatanWorkbenchCards();
});

test('workbench bank batches 8:2 and 12:3 exchanges', () => {
  resetCatanWorkbenchCards();
  for (let i = 0; i < 8; i++) {
    adjustCatanWorkbenchHand('brick', 1);
    adjustCatanWorkbenchTradeStaging('give', 'brick', 1);
  }
  adjustCatanWorkbenchTradeStaging('receive', 'lumber', 1);
  adjustCatanWorkbenchTradeStaging('receive', 'ore', 1);
  assert.deepEqual(stagedCatanBankTrade(), { give: 'brick', gets: ['lumber', 'ore'], rate: 4 });
  assert.equal(performStagedCatanWorkbenchBankTrade(), true);
  let view = catanWorkbenchView();
  assert.equal(view.hand.brick, 0);
  assert.equal(view.hand.lumber, 1);
  assert.equal(view.hand.ore, 1);

  resetCatanWorkbenchCards();
  for (let i = 0; i < 12; i++) {
    adjustCatanWorkbenchHand('grain', 1);
    adjustCatanWorkbenchTradeStaging('give', 'grain', 1);
  }
  adjustCatanWorkbenchTradeStaging('receive', 'lumber', 1);
  adjustCatanWorkbenchTradeStaging('receive', 'wool', 2);
  assert.deepEqual(stagedCatanBankTrade(), { give: 'grain', gets: ['lumber', 'wool', 'wool'], rate: 4 });
  assert.equal(performStagedCatanWorkbenchBankTrade(), true);
  view = catanWorkbenchView();
  assert.equal(view.hand.grain, 0);
  assert.equal(view.hand.lumber, 1);
  assert.equal(view.hand.wool, 2);
  assert.match(view.history.at(-1)?.message ?? '', /traded 12 wheat for 1 wood \+ 2 sheep via bank/);
  resetCatanWorkbenchCards();
});

test('batched maritime trades require one requested card per complete ratio and exclude the offered resource', () => {
  resetCatanWorkbenchCards();
  const rates = maritimePortTradeRates([{ ratio: 2, resource: 'grain' }]);
  for (let i = 0; i < 4; i++) {
    adjustCatanWorkbenchHand('grain', 1);
    adjustCatanWorkbenchTradeStaging('give', 'grain', 1);
  }
  adjustCatanWorkbenchTradeStaging('receive', 'ore', 1);
  assert.equal(stagedCatanPortTrade(rates), null);
  adjustCatanWorkbenchTradeStaging('receive', 'grain', 1);
  assert.equal(stagedCatanPortTrade(rates), null);
  adjustCatanWorkbenchTradeStaging('receive', 'grain', -1);
  adjustCatanWorkbenchTradeStaging('receive', 'brick', 1);
  assert.deepEqual(stagedCatanPortTrade(rates), { give: 'grain', gets: ['brick', 'ore'], rate: 2 });
  resetCatanWorkbenchCards();
});

test('workbench bank trade rejects short payments and identical resources', () => {
  resetCatanWorkbenchCards();
  for (let i = 0; i < 3; i++) adjustCatanWorkbenchHand('grain', 1);
  assert.equal(performCatanWorkbenchBankTrade('grain', 'ore'), false);
  adjustCatanWorkbenchHand('grain', 1);
  assert.equal(performCatanWorkbenchBankTrade('grain', 'grain'), false);
  assert.equal(performCatanWorkbenchPortTrade('grain', 'ore', maritimePortTradeRates([{ ratio: 2, resource: 'brick' }])), false);
  resetCatanWorkbenchCards();
});

test('bank remains a separate fixed 4:1 option when the player owns a port', () => {
  const ports = [{ ratio: 2, resource: 'brick' }] as const;
  const rates = maritimeTradeRates(ports);
  const portRates = maritimePortTradeRates(ports);
  resetCatanWorkbenchCards();
  for (let i = 0; i < 4; i++) {
    adjustCatanWorkbenchHand('brick', 1);
    adjustCatanWorkbenchTradeStaging('give', 'brick', 1);
  }
  adjustCatanWorkbenchTradeStaging('receive', 'ore', 1);
  assert.deepEqual(stagedCatanBankTrade(), { give: 'brick', gets: ['ore'], rate: 4 });
  assert.equal(stagedCatanPortTrade(portRates), null);
  assert.equal(performStagedCatanWorkbenchBankTrade(), true);
  const view = catanWorkbenchView(rates, portRates);
  assert.equal(view.hand.brick, 0);
  assert.equal(view.hand.ore, 1);
  assert.match(view.history.at(-1)?.message ?? '', /traded 4 brick for 1 ore via bank/);
  resetCatanWorkbenchCards();
});

test('staged port trade rejects missing ports, insufficient payments, and excessive payments', () => {
  const rates = maritimePortTradeRates([{ ratio: 3, resource: null }]);
  resetCatanWorkbenchCards();
  for (let i = 0; i < 4; i++) adjustCatanWorkbenchHand('grain', 1);
  for (let i = 0; i < 2; i++) adjustCatanWorkbenchTradeStaging('give', 'grain', 1);
  adjustCatanWorkbenchTradeStaging('receive', 'ore', 1);
  assert.equal(stagedCatanPortTrade(maritimePortTradeRates([])), null);
  assert.equal(stagedCatanPortTrade(rates), null);
  assert.equal(performStagedCatanWorkbenchPortTrade(rates), false);

  adjustCatanWorkbenchTradeStaging('give', 'grain', 1);
  assert.deepEqual(stagedCatanPortTrade(rates), { give: 'grain', gets: ['ore'], rate: 3 });
  adjustCatanWorkbenchTradeStaging('give', 'grain', 1);
  assert.equal(stagedCatanPortTrade(rates), null);
  assert.equal(performStagedCatanWorkbenchPortTrade(rates), false);
  resetCatanWorkbenchCards();
});

test('workbench bank trade cannot request an unavailable bank resource', () => {
  resetCatanWorkbenchCards();
  for (let i = 0; i < 17 * 4 + 4; i++) adjustCatanWorkbenchHand('brick', 1);
  for (let i = 0; i < 4; i++) adjustCatanWorkbenchTradeStaging('give', 'brick', 1);
  adjustCatanWorkbenchTradeStaging('receive', 'ore', 1);
  for (let i = 0; i < 17; i++) assert.equal(performCatanWorkbenchBankTrade('brick', 'ore'), true);
  assert.equal(catanWorkbenchView().bank.ore, 0);
  assert.equal(stagedCatanBankTrade(), null);
  assert.equal(performStagedCatanWorkbenchBankTrade(), false);
  resetCatanWorkbenchCards();
});

test('staged bank trade rejects mixed give cards and supports moving one card back', () => {
  resetCatanWorkbenchCards();
  for (let i = 0; i < 2; i++) {
    adjustCatanWorkbenchHand('brick', 1);
    adjustCatanWorkbenchHand('grain', 1);
    adjustCatanWorkbenchTradeStaging('give', 'brick', 1);
    adjustCatanWorkbenchTradeStaging('give', 'grain', 1);
  }
  adjustCatanWorkbenchTradeStaging('receive', 'ore', 1);
  assert.equal(performStagedCatanWorkbenchBankTrade(), false);
  assert.equal(adjustCatanWorkbenchTradeStaging('give', 'grain', -1), true);
  assert.equal(catanWorkbenchView().hand.grain, 2);
  resetCatanWorkbenchCards();
});

test('workbench player trade waits for every opponent and can complete an accepted offer', () => {
  resetCatanWorkbenchCards();
  adjustCatanWorkbenchHand('brick', 1);
  adjustCatanWorkbenchTradeStaging('give', 'brick', 1);
  adjustCatanWorkbenchTradeStaging('receive', 'wool', 1);
  const view = catanWorkbenchView();
  const id = createCatanWorkbenchPlayerTrade(view.localPlayer, view.opponents, () => {});
  assert.equal(id, 1);
  const pending = catanWorkbenchPlayerTradeOffers()[0];
  assert.equal(pending.reactions.length, view.opponents.length);
  assert.deepEqual(pending.reactions.map((reaction) => reaction.status), ['pending', 'pending', 'pending']);

  assert.equal(resolveCatanWorkbenchPlayerTradeOffer(id!), true);
  const decided = catanWorkbenchPlayerTradeOffers()[0];
  assert.deepEqual(decided.reactions.map((reaction) => reaction.status), ['accepted', 'rejected', 'rejected']);
  assert.equal(completeCatanWorkbenchPlayerTrade(id!, decided.reactions[0].player.name), true);
  assert.equal(catanWorkbenchPlayerTradeOffers().length, 0);
  assert.equal(catanWorkbenchView().hand.brick, 0);
  assert.equal(catanWorkbenchView().hand.wool, 1);
  resetCatanWorkbenchCards();
});

test('workbench player trade can be cancelled while reactions are pending', () => {
  resetCatanWorkbenchCards();
  adjustCatanWorkbenchHand('grain', 1);
  adjustCatanWorkbenchTradeStaging('give', 'grain', 1);
  adjustCatanWorkbenchTradeStaging('receive', 'ore', 1);
  const view = catanWorkbenchView();
  const id = createCatanWorkbenchPlayerTrade(view.localPlayer, view.opponents, () => {});
  assert.notEqual(id, null);
  assert.equal(cancelCatanWorkbenchPlayerTrade(id!), true);
  assert.equal(catanWorkbenchPlayerTradeOffers().length, 0);
  assert.equal(catanWorkbenchView().hand.grain, 1);
  resetCatanWorkbenchCards();
});

test('player trade popup constrains a long model name before the exchange tokens', () => {
  const view = catanWorkbenchView();
  const controller: CatanPlayerTradeOffersController = {
    offers: [{
      id: 99,
      offerer: { ...view.localPlayer, name: 'grok-4.1-fast-non-reasoning' },
      give: { lumber: 0, brick: 1, wool: 0, grain: 0, ore: 0 },
      get: { lumber: 0, brick: 0, wool: 0, grain: 1, ore: 0 },
      reactions: [],
    }],
  };
  const root = buildCatanCardsOverlay(
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
  const name = nodes.find((node) => node.text === 'grok-4.1-fast-non-reasoning');
  assert.ok(name);
  assert.equal(name.style.textOverflow, 'ellipsis');
  assert.equal(typeof name.style.width, 'number');
});

test('workbench development purchase spends the official cost and draws a card', () => {
  resetCatanWorkbenchCards();
  adjustCatanWorkbenchHand('ore', 1);
  adjustCatanWorkbenchHand('wool', 1);
  adjustCatanWorkbenchHand('grain', 1);

  assert.equal(buyCatanWorkbenchDevCard(), true);
  const view = catanWorkbenchView();
  assert.equal(view.hand.ore, 0);
  assert.equal(view.hand.wool, 0);
  assert.equal(view.hand.grain, 0);
  assert.equal(view.developmentDeck, 24);
  assert.equal(Object.values(view.devHand).reduce((sum, count) => sum + count, 0), 1);
  assert.match(view.history.at(-1)?.message ?? '', /bought a development card/);
  resetCatanWorkbenchCards();
});

test('animated development purchase debits the deck at departure and reveals the card at landing', () => {
  resetCatanWorkbenchCards();
  adjustCatanWorkbenchHand('ore', 1);
  adjustCatanWorkbenchHand('wool', 1);
  adjustCatanWorkbenchHand('grain', 1);

  const drawn = beginCatanWorkbenchDevPurchase();
  assert.notEqual(drawn, null);
  let view = catanWorkbenchView();
  assert.equal(view.hand.ore, 0);
  assert.equal(view.hand.wool, 0);
  assert.equal(view.hand.grain, 0);
  assert.equal(view.developmentDeck, 25, 'the pile remains unchanged until the card launches');
  assert.equal(Object.values(view.devHand).reduce((sum, count) => sum + count, 0), 0);

  assert.equal(departCatanWorkbenchDevCard(drawn!), true);
  view = catanWorkbenchView();
  assert.equal(view.developmentDeck, 24);
  assert.equal(Object.values(view.devHand).reduce((sum, count) => sum + count, 0), 0);

  landCatanWorkbenchDevCard(drawn!);
  logCatanWorkbenchDevPurchase();
  view = catanWorkbenchView();
  assert.equal(view.devHand[drawn!], 1);
  assert.match(view.history.at(-1)?.message ?? '', /bought a development card/);
  resetCatanWorkbenchCards();
});

test('development purchases reserve distinct deck cards while earlier cards are still flying', () => {
  resetCatanWorkbenchCards();
  for (let purchase = 0; purchase < 2; purchase++) {
    adjustCatanWorkbenchHand('ore', 1);
    adjustCatanWorkbenchHand('wool', 1);
    adjustCatanWorkbenchHand('grain', 1);
  }

  const first = beginCatanWorkbenchDevPurchase();
  const second = beginCatanWorkbenchDevPurchase();
  assert.notEqual(first, null);
  assert.notEqual(second, null);
  assert.equal(catanWorkbenchView().developmentDeck, 25, 'reserved cards remain visible on the pile until launch');

  assert.equal(departCatanWorkbenchDevCard(first!), true);
  assert.equal(catanWorkbenchView().developmentDeck, 24);
  assert.equal(departCatanWorkbenchDevCard(second!), true);
  assert.equal(catanWorkbenchView().developmentDeck, 23);
  landCatanWorkbenchDevCard(first!);
  landCatanWorkbenchDevCard(second!);
  assert.equal(Object.values(catanWorkbenchView().devHand).reduce((sum, count) => sum + count, 0), 2);
  resetCatanWorkbenchCards();
});

test('an in-flight development purchase leaves trade and another purchase enabled', () => {
  resetCatanWorkbenchCards();
  for (let purchase = 0; purchase < 2; purchase++) {
    adjustCatanWorkbenchHand('ore', 1);
    adjustCatanWorkbenchHand('wool', 1);
    adjustCatanWorkbenchHand('grain', 1);
  }
  adjustCatanWorkbenchHand('brick', 4);
  const region = { x: 0, y: 0, w: 180, h: 60 };
  const screen = new Screen(region.w, region.h);
  const controller = new CatanController({
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
  const firstBuy = findNode(root, 'catan-buy-dev');
  assert.equal(firstBuy?.disabled, false);
  firstBuy?.onClick?.();

  root = controller.buildRoot(region.w, region.h);
  const trade = findNode(root, 'catan-trade-open');
  const secondBuy = findNode(root, 'catan-buy-dev');
  assert.equal(trade?.disabled, false, 'trade remains available during the card flight');
  assert.equal(secondBuy?.disabled, false, 'another purchase remains available during the card flight');
  secondBuy?.onClick?.();
  assert.equal(catanWorkbenchView().hand.ore, 0, 'both queued purchases commit their costs');

  controller.reset();
  resetCatanWorkbenchCards();
});

test('workbench development cards play from the paid hand while victory points remain passive', () => {
  resetCatanWorkbenchCards();
  adjustCatanWorkbenchDev('knight', 1);
  adjustCatanWorkbenchDev('roadBuilding', 1);
  adjustCatanWorkbenchDev('victoryPoint', 1);

  assert.equal(beginCatanWorkbenchDevelopmentPlay('victoryPoint'), false);
  assert.equal(catanWorkbenchView().devHand.victoryPoint, 1);

  assert.equal(beginCatanWorkbenchDevelopmentPlay('knight'), true);
  assert.deepEqual(catanWorkbenchDevelopmentPlay(), { type: 'knight', remaining: 1, resources: [] });
  assert.equal(catanWorkbenchView().devHand.knight, 0);
  assert.equal(catanWorkbenchView().localPlayer.knights, 3);
  assert.equal(completeCatanWorkbenchDevelopmentStep('knight'), true);
  assert.equal(catanWorkbenchDevelopmentPlay(), null);

  assert.equal(beginCatanWorkbenchDevelopmentPlay('roadBuilding'), true);
  assert.equal(completeCatanWorkbenchDevelopmentStep('roadBuilding'), true);
  assert.deepEqual(catanWorkbenchDevelopmentPlay(), { type: 'roadBuilding', remaining: 1, resources: [] });
  assert.equal(completeCatanWorkbenchDevelopmentStep('roadBuilding'), true);
  assert.equal(catanWorkbenchDevelopmentPlay(), null);
  assert.match(catanWorkbenchView().history.at(-1)?.message ?? '', /played road building/);
  resetCatanWorkbenchCards();
});

test('workbench year of plenty draws from the bank and monopoly records its named resource', () => {
  resetCatanWorkbenchCards();
  adjustCatanWorkbenchDev('yearOfPlenty', 1);
  adjustCatanWorkbenchDev('monopoly', 1);

  const oreBefore = catanWorkbenchView().bank.ore;
  assert.equal(beginCatanWorkbenchDevelopmentPlay('yearOfPlenty'), true);
  assert.equal(chooseCatanWorkbenchDevelopmentResource('ore'), true);
  assert.equal(chooseCatanWorkbenchDevelopmentResource('ore'), true);
  let view = catanWorkbenchView();
  assert.equal(view.hand.ore, 2);
  assert.equal(view.bank.ore, oreBefore - 2);
  assert.equal(view.developmentPlay, undefined);
  assert.deepEqual(view.history.at(-1)?.resources, ['ore', 'ore']);

  assert.equal(beginCatanWorkbenchDevelopmentPlay('monopoly'), true);
  assert.equal(chooseCatanWorkbenchDevelopmentResource('grain'), true);
  view = catanWorkbenchView();
  assert.equal(view.developmentPlay, undefined);
  assert.match(view.history.at(-1)?.message ?? '', /named wheat for monopoly/);
  resetCatanWorkbenchCards();
});

test('workbench development purchases exhaust the official uneven 25-card deck', () => {
  resetCatanWorkbenchCards();
  for (let i = 0; i < 25; i++) {
    adjustCatanWorkbenchHand('ore', 1);
    adjustCatanWorkbenchHand('wool', 1);
    adjustCatanWorkbenchHand('grain', 1);
    assert.equal(buyCatanWorkbenchDevCard(), true);
  }

  const view = catanWorkbenchView();
  assert.equal(view.developmentDeck, 0);
  assert.deepEqual(view.devHand, DEV_CARD_COUNTS);
  adjustCatanWorkbenchHand('ore', 1);
  adjustCatanWorkbenchHand('wool', 1);
  adjustCatanWorkbenchHand('grain', 1);
  assert.equal(buyCatanWorkbenchDevCard(), false);
  resetCatanWorkbenchCards();
});

test('workbench reset restores the complete bank and development deck', () => {
  resetCatanWorkbenchCards();
  adjustCatanWorkbenchHand('ore', 1);
  adjustCatanWorkbenchHand('wool', 1);
  adjustCatanWorkbenchHand('grain', 1);
  assert.equal(buyCatanWorkbenchDevCard(), true);

  const bought = catanWorkbenchView();
  assert.equal(bought.developmentDeck, 24);
  assert.equal(Object.values(bought.devHand).reduce((sum, count) => sum + count, 0), 1);

  resetCatanWorkbenchCards();
  const reset = catanWorkbenchView();
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
