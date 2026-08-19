// Scene-level only. The card HUD's presentation (labels, casing, glyphs, widths, which stats
// show) is in fast visual iteration and is deliberately NOT asserted here — those tests break
// every turn and cost more than they catch. Verify the UI with `pnpm snapshot ... board-cards hud`
// and look at the PNG instead.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mulberry32, RenderTarget } from '../../../engine/index.ts';
import { Screen } from '../../../tui/index.ts';
import { maritimePortTradeRates, maritimeTradeRates } from '../../../rules/catan/maritime-trade.ts';
import { generateBoard } from '../../../rules/catan/setup.ts';
import { DEV_CARD_COUNTS } from '../../../rules/catan/types.ts';
import {
  adjustCatanWorkbenchHand,
  adjustCatanWorkbenchTradeStaging,
  bankCatanResource,
  beginCatanWorkbenchDevPurchase,
  beginStagedCatanWorkbenchBankTrade,
  buildCatanCardsOverlay,
  buyCatanWorkbenchDevCard,
  cancelCatanWorkbenchPlayerTrade,
  catanWorkbenchPlayerTradeOffers,
  catanBankDepartureCell,
  catanDevDeckDepartureCell,
  catanDevHandLandingCell,
  catanHandLandingCell,
  catanWorkbenchView,
  completeCatanWorkbenchPlayerTrade,
  createCatanWorkbenchPlayerTrade,
  departCatanWorkbenchBankResource,
  departCatanWorkbenchDevCard,
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
} from './card-hud.ts';
import { stagedCatanBankTrade, stagedCatanPortTrade } from './card-workbench.ts';
import { CATAN_CARD, DEV_HAND_LOOK } from './palette.ts';
import { TileScene } from './tile-scene.ts';

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
  view.pendingDevelopmentCard = 'knight';
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
  view.pendingDevelopmentCard = 'knight';
  const landing = catanDevHandLandingCell(region, 'knight', false, view);
  const screen = new Screen(region.w, region.h);

  screen.setRoot(buildCatanCardsOverlay(region, () => {}, view), region);
  const pending = screen.snapshot(() => {});
  assert.deepEqual(pending.getCell(landing.col, landing.row)?.bg, CATAN_CARD.emptyFill);

  view.devHand.knight = 1;
  view.developmentPurchaseBusy = false;
  delete view.pendingDevelopmentCard;
  screen.setRoot(buildCatanCardsOverlay(region, () => {}, view), region);
  const landed = screen.snapshot(() => {});
  assert.deepEqual(landed.getCell(landing.col, landing.row)?.bg, DEV_HAND_LOOK.knight.fill);
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

test('animated maritime settlement debits each bank card at departure and credits it at landing', () => {
  resetCatanWorkbenchCards();
  for (let i = 0; i < 8; i++) {
    adjustCatanWorkbenchHand('brick', 1);
    adjustCatanWorkbenchTradeStaging('give', 'brick', 1);
  }
  adjustCatanWorkbenchTradeStaging('receive', 'ore', 2);

  const trade = beginStagedCatanWorkbenchBankTrade();
  assert.deepEqual(trade, { give: 'brick', gets: ['ore', 'ore'], rate: 4 });
  let view = catanWorkbenchView();
  assert.equal(view.hand.brick, 0, 'payment commits when the trade begins');
  assert.equal(view.bank.brick, 26);
  assert.equal(view.bank.ore, 17, 'incoming bank cards remain until their individual departures');
  assert.equal(view.hand.ore, 0, 'incoming cards are not credited before landing');

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
