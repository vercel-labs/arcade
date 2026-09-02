import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('cinematics use shared production visuals instead of handmade substitutes', () => {
  const cinematic = readFileSync(new URL('./browser-game-cinematics.ts', import.meta.url), 'utf8');
  const chess = readFileSync(new URL('./browser-chess.ts', import.meta.url), 'utf8');
  for (const forbidden of ['tetrahedron(', 'settlementMesh', 'function drawPort', 'function drawShuffle', 'function drawPeek(']) {
    assert.ok(!cinematic.includes(forbidden), `cinematic should not contain ${forbidden}`);
  }
  for (const required of ['DeckShuffle', 'drawPeekCard', 'fetchPokerTableMeshes', 'boardOverlayMesh', 'boardHarborPoses', 'harborPiersMesh', 'islandersWaterMesh', 'BrowserCreatorWisps']) {
    assert.ok(cinematic.includes(required), `cinematic should use ${required}`);
  }
  for (const shared of ['POKER_WOOD_BROWN', 'POKER_TABLE_LIGHT', 'POKER_TABLE_AMBIENT', 'POKER_FELT_STIPPLE', 'POKER_TABLE_ASCII_CONTRAST']) assert.ok(cinematic.includes(shared));
  assert.ok(!cinematic.includes('const WOOD: RGB = [92, 54, 34]'));
  assert.ok(chess.includes('pieceMaterial'));
  assert.ok(chess.includes('BrowserCreatorWisps'));
  assert.ok(!chess.includes('wispMesh'));
});

test('web Islanders extends the shared production bridges as ships settle', () => {
  const cinematic = readFileSync(new URL('./browser-game-cinematics.ts', import.meta.url), 'utf8');
  assert.ok(cinematic.includes('this.harbors[i].connector'));
  assert.ok(cinematic.includes('(progress - 0.62) / 0.38'));
  assert.ok(cinematic.includes('coastMesh(coastProgress)'), 'web must render the shared shoreline beneath bridge endpoints');
  assert.ok(
    cinematic.indexOf('draw(coastMesh(coastProgress)') < cinematic.indexOf('draw(harborPiersMesh('),
    'shoreline must be present before harbor bridges are composited',
  );
  assert.ok(!cinematic.includes('function walkway('), 'web must not hand-roll bridge geometry');
});

test('cinematic wisps retain production brand and placement semantics', () => {
  const wisp = readFileSync(new URL('./browser-wisp.ts', import.meta.url), 'utf8');
  const poker = readFileSync(new URL('./browser-game-cinematics.ts', import.meta.url), 'utf8');
  const chess = readFileSync(new URL('./browser-chess.ts', import.meta.url), 'utf8');
  for (const creator of ['xai', 'openai', 'anthropic', 'google', 'deepseek']) assert.ok(wisp.includes(creator));
  assert.ok(wisp.includes("anthropic: new URL('../../assets/logos/claude.png'"));
  assert.ok(poker.includes('Math.sin(angle) * radius'));
  assert.ok(poker.includes('Math.cos(angle) * radius'));
  assert.ok(chess.includes('kingPosition(WHITE)'));
  assert.ok(chess.includes('kingPosition(BLACK)'));
  assert.ok(poker.includes('preparePokerCardTextures'));
  assert.ok(poker.includes('seatCount = 5'));
  assert.ok(poker.includes('for (let seat = 0; seat < this.seatCount; seat++)'));
  assert.ok(poker.includes('for (let round = 0; round < 2; round++)'));
  assert.ok(poker.includes('hand.seatPeeks[seat]'));
  assert.ok(poker.includes('drawCardStock'));
  assert.ok(poker.includes('pokerStackCenter'));
  assert.ok(poker.includes('pokerHoleCardPose(seat, round, this.seatCount)'));
  assert.ok(poker.includes('drawIslandersDiceOverlay'));
  assert.ok(!poker.includes('draw(dieMesh()'));
  assert.ok(poker.includes('gameplayPhase = cameraProgress'));
  assert.ok(poker.includes('hand.shuffle * this.shuffle.loop * 2'));
  assert.ok(poker.includes('pokerLoopState(gameplayPhase)'));
  assert.ok(poker.includes('createPokerMuckCards'));
  assert.ok(poker.includes('pokerMuckCardPose'));
  assert.ok(poker.includes('createPokerGatherCard'));
  assert.ok(poker.includes('pokerGatherCardPose'));
  assert.ok(poker.includes('takeChipColumns'));
  assert.ok(poker.includes('mergeChipColumns'));
  assert.ok(poker.includes('pokerChipFlight'));
  const wispSection = poker.slice(poker.indexOf('// Production seat convention:'), poker.indexOf('const surface = present'));
  assert.ok(!wispSection.includes('hand.foldedSeats'), 'folded players keep their seated wisps');
});

test('Chess cinematic delegates every special move to the production segment planner', () => {
  const chess = readFileSync(new URL('./browser-chess.ts', import.meta.url), 'utf8');
  const production = readFileSync(new URL('../arcade/games/chess/scene.ts', import.meta.url), 'utf8');
  for (const source of [chess, production]) {
    assert.ok(source.includes('planChessMove'));
    assert.ok(source.includes('chessMovePosition'));
  }
  assert.ok(chess.includes('movingKingPosition'));
  assert.ok(!chess.includes('Math.sin(t * Math.PI) * 0.72'));
});

test('terminal and browser share the exact production Islanders dice overlay', () => {
  const cinematic = readFileSync(new URL('./browser-game-cinematics.ts', import.meta.url), 'utf8');
  const game = readFileSync(new URL('../arcade/games/islanders/tile-scene.ts', import.meta.url), 'utf8');
  const overlay = readFileSync(new URL('../game-visuals/islanders/dice-overlay.ts', import.meta.url), 'utf8');
  assert.ok(cinematic.includes('preserveSceneDepth: true'));
  assert.ok(game.includes('drawIslandersDiceOverlay(target, this.dice'));
  assert.ok(overlay.includes('target.depth.fill(Infinity)'));
  assert.ok(overlay.includes('diceViewport()'));
});

test('Islanders cinematic draws dice after settlements so pieces cannot cover them', () => {
  const cinematic = readFileSync(new URL('./browser-game-cinematics.ts', import.meta.url), 'utf8');
  const overlay = cinematic.indexOf('if (buildings.length || roads.length) draw(overlay');
  const dice = cinematic.indexOf('drawIslandersDiceOverlay(target, this.dice');
  assert.ok(overlay >= 0 && dice > overlay, 'dice must be the final board-space layer');
});
