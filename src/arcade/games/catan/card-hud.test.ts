// Scene-level only. The card HUD's presentation (labels, casing, glyphs, widths, which stats
// show) is in fast visual iteration and is deliberately NOT asserted here — those tests break
// every turn and cost more than they catch. Verify the UI with `pnpm snapshot ... board-cards hud`
// and look at the PNG instead.
import assert from 'node:assert/strict';
import test from 'node:test';
import { RenderTarget } from '../../../engine/index.ts';
import { DEV_CARD_COUNTS } from '../../../rules/catan/types.ts';
import {
  adjustCatanWorkbenchHand,
  adjustCatanWorkbenchTradeStaging,
  buyCatanWorkbenchDevCard,
  catanHandLandingCell,
  catanWorkbenchView,
  performCatanWorkbenchBankTrade,
  performStagedCatanWorkbenchBankTrade,
  resetCatanWorkbenchCards,
} from './card-hud.ts';
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

test('workbench bank trade rejects short payments and identical resources', () => {
  resetCatanWorkbenchCards();
  for (let i = 0; i < 3; i++) adjustCatanWorkbenchHand('grain', 1);
  assert.equal(performCatanWorkbenchBankTrade('grain', 'ore'), false);
  adjustCatanWorkbenchHand('grain', 1);
  assert.equal(performCatanWorkbenchBankTrade('grain', 'grain'), false);
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
