import assert from 'node:assert/strict';
import test from 'node:test';
import { RenderTarget } from '../../../engine/index.ts';
import { TOKEN_DOTS } from '../../../rules/catan/types.ts';
import { layout, type Node } from '../../../tui/index.ts';
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

test('number-token pips disappear when the board is zoomed out but numbers remain', () => {
  const scene = new TileScene();
  scene.setMode('board');
  scene.settle();
  scene.zoomBy(1.21); // home distance 13.2 → 15.972, beyond the pip-detail threshold

  const tokens = scene.boardTokens(160, 90);
  assert.equal(tokens.length, 18);
  assert.ok(tokens.every((token) => !token.showPips));
  assert.ok(tokens.every((token) => Number.isInteger(token.num)));
});

test('the board reveal flickers numbers alone, then grows final pips out from the center', () => {
  const scene = new TileScene();
  scene.setMode('board');
  const target = new RenderTarget(96, 64);
  const frame = (time: number) => {
    scene.renderScene(target, time);
    return scene.boardTokens(96, 32);
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
  const token = { col: 20, row: 10, num: 6, pips: 5, showPips: true, red: true, hot: false };
  const detailed = texts(buildCatanTileRoot({ x: 0, y: 0, w: 80, h: 40 }, () => {}, [token], 'board'));
  assert.ok(detailed.includes('6'));
  assert.ok(detailed.includes('•••••'));

  const distant = texts(buildCatanTileRoot({ x: 0, y: 0, w: 80, h: 40 }, () => {}, [{ ...token, showPips: false }], 'board'));
  assert.ok(distant.includes('6'));
  assert.ok(!distant.includes('•••••'));
});

test('all parity combinations use regular bullets centered with left-biased ties', () => {
  const region = { x: 0, y: 0, w: 80, h: 40 };
  const threePips = buildCatanTileRoot(region, () => {}, [
    { col: 20, row: 10, num: 10, pips: 3, showPips: true, red: false, hot: false },
  ], 'board');
  layout(threePips, region);
  assert.equal(findText(threePips, '10')?.layout?.x, findText(threePips, '•••')?.layout?.x);

  const fivePips = buildCatanTileRoot(region, () => {}, [
    { col: 20, row: 10, num: 6, pips: 5, showPips: true, red: true, hot: false },
  ], 'board');
  layout(fivePips, region);
  assert.equal((findText(fivePips, '6')?.layout?.x ?? 0) - (findText(fivePips, '•••••')?.layout?.x ?? 0), 2);

  const onePip = buildCatanTileRoot(region, () => {}, [
    { col: 20, row: 10, num: 12, pips: 1, showPips: true, red: false, hot: false },
  ], 'board');
  layout(onePip, region);
  assert.equal(findText(onePip, '12')?.layout?.x, findText(onePip, '•')?.layout?.x);
});
