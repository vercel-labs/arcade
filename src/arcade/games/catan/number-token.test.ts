import assert from 'node:assert/strict';
import test from 'node:test';
import { RenderTarget } from '../../../engine/index.ts';
import { TOKEN_DOTS } from '../../../rules/catan/types.ts';
import { layout, type Node, Screen } from '../../../tui/index.ts';
import { buildCatanTileRoot } from './tile-hud.ts';
import { TileScene } from './tile-scene.ts';

function texts(node: Node): string[] {
  return [...(node.text ? [node.text] : []), ...(node.children ?? []).flatMap(texts)];
}

function findText(node: Node, text: string): Node | undefined {
  if (node.text === text) return node;
  for (const child of node.children ?? []) {
    const found = findText(child, text);
    if (found) return found;
  }
  return undefined;
}

test('board number tokens expose the official production pips at readable zooms', () => {
  const scene = new TileScene();
  scene.setMode('board');
  scene.settle();

  const tokens = scene.boardTokens(160, 90);
  assert.equal(tokens.length, 18);
  for (const token of tokens) {
    assert.equal(token.pips, TOKEN_DOTS[token.num]);
    assert.equal(token.showPips, true);
  }
});

test('number-token pips follow projected hex size rather than camera distance alone', () => {
  const scene = new TileScene();
  scene.setMode('board');
  scene.settle();
  scene.zoomBy(1.21); // home distance 13.2 → 15.972

  const compact = scene.boardTokens(96, 32);
  assert.equal(compact.length, 18);
  assert.ok(compact.every((token) => !token.showPips));
  assert.ok(compact.every((token) => Number.isInteger(token.num)));

  // The camera did not move again; the larger viewport alone makes the same hexes readable.
  const spacious = scene.boardTokens(160, 90);
  assert.ok(spacious.every((token) => token.showPips));
});

test('a compact terminal suppresses pips at the same home zoom where a larger one shows them', () => {
  const scene = new TileScene();
  scene.setMode('board');
  scene.settle();

  assert.ok(scene.boardTokens(80, 24).every((token) => !token.showPips));
  assert.ok(scene.boardTokens(160, 90).every((token) => token.showPips));
});

test('an oblique but still large board retains pips from its complete projected footprint', () => {
  const scene = new TileScene();
  scene.setMode('board');
  scene.settle();
  // Lower the default 47-degree elevation to roughly 23 degrees. The hexes become shorter but
  // remain wide and well separated in this large terminal.
  scene.orbit(0, ((-24 * Math.PI) / 180) / 0.02);

  assert.ok(scene.boardTokens(150, 88).every((token) => token.showPips));
});

test('a large terminal suppresses pips once the projected board becomes too small', () => {
  const scene = new TileScene();
  scene.setMode('board');
  scene.settle();

  assert.ok(scene.boardTokens(160, 90).every((token) => token.showPips));
  scene.zoomBy(1.8);
  assert.ok(scene.boardTokens(160, 90).every((token) => !token.showPips));
});

test('the board reveal flickers numbers alone, then grows final pips out from the center', () => {
  const scene = new TileScene();
  scene.setMode('board');
  const target = new RenderTarget(160, 180);
  const frame = (time: number) => {
    scene.renderScene(target, time);
    return scene.boardTokens(160, 90);
  };

  frame(0); // start the placement clock
  const firstSpin = frame(5.3); // placement completes and starts the token reveal
  const secondSpin = frame(5.38); // advance past one number-flicker step
  assert.ok(firstSpin.every((token) => token.pips === 0 && !token.showPips));
  assert.ok(secondSpin.every((token) => token.pips === 0 && !token.showPips));
  assert.notDeepEqual(secondSpin.map((token) => token.num), firstSpin.map((token) => token.num));

  const growing = frame(6.0);
  assert.ok(growing.some((token) => token.pips > 0));
  assert.ok(growing.some((token) => token.pips === 0));

  const settled = frame(6.5);
  assert.ok(settled.every((token) => token.pips === TOKEN_DOTS[token.num] && token.showPips));
  const totals = new Map(settled.map((token) => [`${token.col},${token.row}`, token.pips]));
  for (const token of growing) {
    const total = totals.get(`${token.col},${token.row}`);
    assert.notEqual(total, undefined);
    const allowed = total! % 2 === 1 ? [0, 1, 3, 5] : [0, 1, 2, 4];
    assert.ok(allowed.includes(token.pips), `${token.pips} is not a center-out stage for ${total} pips`);
  }
});

test('the token overlay renders compact unspaced bullet pips only when requested', () => {
  const token = { col: 20, row: 10, num: 6, pips: 5, showPips: true, red: true, hot: false, blocked: false };
  const detailed = texts(buildCatanTileRoot({ x: 0, y: 0, w: 80, h: 40 }, () => {}, [token], 'board'));
  assert.ok(detailed.includes('6'));
  assert.ok(detailed.includes('•••••'));

  const distant = texts(buildCatanTileRoot({ x: 0, y: 0, w: 80, h: 40 }, () => {}, [{ ...token, showPips: false }], 'board'));
  assert.ok(distant.includes('6'));
  assert.ok(!distant.includes('•••••'));
});

test('number-token overlays do not intercept board clicks', () => {
  const region = { x: 0, y: 0, w: 80, h: 40 };
  const token = { col: 20, row: 10, num: 6, pips: 5, showPips: true, red: true, hot: false, blocked: false };
  const screen = new Screen(region.w, region.h);
  screen.setRoot(buildCatanTileRoot(region, () => {}, [token], 'board', [], [], true), region);

  // Screen pointer coordinates are 1-based. This is the visual centre of the
  // projected two-row number chip and must fall through to the board raycast.
  assert.equal(screen.pointerDown(token.col + 1, token.row + 1), null);
});

test('detailed token rows straddle the projected center while number-only tokens sit on it', () => {
  const region = { x: 0, y: 0, w: 80, h: 40 };
  const token = { col: 20, row: 10, num: 6, pips: 5, showPips: true, red: true, hot: false, blocked: false };
  const detailed = buildCatanTileRoot(region, () => {}, [token], 'board');
  layout(detailed, region);
  assert.equal(findText(detailed, '6')?.layout?.y, 9);
  assert.equal(findText(detailed, '•••••')?.layout?.y, 10);

  const distant = buildCatanTileRoot(region, () => {}, [{ ...token, showPips: false }], 'board');
  layout(distant, region);
  assert.equal(findText(distant, '6')?.layout?.y, 10);
});

test('all parity combinations use regular bullets centered with left-biased ties', () => {
  const region = { x: 0, y: 0, w: 80, h: 40 };
  const threePips = buildCatanTileRoot(region, () => {}, [
    { col: 20, row: 10, num: 10, pips: 3, showPips: true, red: false, hot: false, blocked: false },
  ], 'board');
  layout(threePips, region);
  assert.equal(findText(threePips, '10')?.layout?.x, findText(threePips, '•••')?.layout?.x);

  const fivePips = buildCatanTileRoot(region, () => {}, [
    { col: 20, row: 10, num: 6, pips: 5, showPips: true, red: true, hot: false, blocked: false },
  ], 'board');
  layout(fivePips, region);
  assert.equal((findText(fivePips, '6')?.layout?.x ?? 0) - (findText(fivePips, '•••••')?.layout?.x ?? 0), 2);

  const onePip = buildCatanTileRoot(region, () => {}, [
    { col: 20, row: 10, num: 12, pips: 1, showPips: true, red: false, hot: false, blocked: false },
  ], 'board');
  layout(onePip, region);
  assert.equal(findText(onePip, '12')?.layout?.x, findText(onePip, '•')?.layout?.x);
});

test('moving the robber keeps the old tile occupied until a different tile is committed', () => {
  const scene = new TileScene();
  scene.setMode('board');
  scene.settle();
  const start = scene.currentRobberHex();
  const destination = Array.from({ length: 19 }, (_, hex) => hex).find((hex) => hex !== start)!;

  scene.beginRobberMove();
  scene.previewRobberHex(destination);
  assert.equal(scene.isMovingRobber(), true);
  assert.equal(scene.currentRobberHex(), start, 'hover is only a preview');
  assert.equal(scene.moveRobberTo(start), false, 'the current tile is not a legal destination');
  assert.equal(scene.currentRobberHex(), start);
  assert.equal(scene.moveRobberTo(destination), true);
  assert.equal(scene.currentRobberHex(), destination);
  assert.equal(scene.isMovingRobber(), false);
});

test('a rolled number is gray-blocked on the robber tile while its other hexes remain productive', () => {
  const scene = new TileScene();
  scene.setMode('board');
  scene.settle();
  const destination = Array.from({ length: 19 }, (_, hex) => hex).find((hex) => scene.numberAtHex(hex) !== null)!;
  const number = scene.numberAtHex(destination)!;
  scene.beginRobberMove();
  assert.equal(scene.moveRobberTo(destination), true);

  const first = Math.max(1, number - 6);
  const second = number - first;
  scene.rollDice([first, second]);
  const target = new RenderTarget(96, 64);
  // The slower die can take just over two seconds to settle; sample after that but well before
  // the three-second chip-highlight hold expires.
  for (let frame = 1; frame <= 150; frame++) scene.renderScene(target, frame / 60);

  const matching = scene.boardTokens(160, 90).filter((token) => token.num === number);
  assert.equal(matching.filter((token) => token.blocked).length, 1);
  assert.ok(matching.some((token) => token.hot) || matching.length === 1);
  assert.ok(matching.every((token) => token.hot !== token.blocked));
});

test('the Catan test HUD announces the robber gate and replaces the roll action', () => {
  const root = buildCatanTileRoot({ x: 0, y: 0, w: 100, h: 40 }, () => {}, [], 'board', [], [], true);
  const copy = texts(root);
  assert.ok(copy.includes('moving robber'));
  assert.ok(copy.includes('choose a different tile'));
  assert.ok(!copy.includes('roll dice'));
});
