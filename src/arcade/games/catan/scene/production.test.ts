import assert from 'node:assert/strict';
import test from 'node:test';
import { mulberry32 } from '../../../../engine/index.ts';
import { hexNodes } from '../../../../rules/catan/board-topology.ts';
import { generateBoard } from '../../../../rules/catan/setup.ts';
import { TERRAIN_RESOURCE } from '../../../../rules/catan/types.ts';
import { rollYield } from './production.ts';

const board = generateBoard(mulberry32(7));
// A producing hex (not the desert, not under the robber) and its token — the roll that pays it.
const hex = board.hexes.findIndex((h, i) => h.token !== null && TERRAIN_RESOURCE[h.terrain] !== null && i !== board.robberHex);
const token = board.hexes[hex].token!;
const resource = TERRAIN_RESOURCE[board.hexes[hex].terrain]!;
const [cornerA, cornerB] = hexNodes[hex];

test('a settlement draws one from each matching hex it touches, a city two', () => {
  assert.deepEqual(rollYield(board, new Map([[cornerA, { city: false, color: 'red' }]]), 'red', token, board.robberHex), { [resource]: 1 });
  assert.deepEqual(rollYield(board, new Map([[cornerA, { city: true, color: 'red' }]]), 'red', token, board.robberHex), { [resource]: 2 });
});

test('production is per seat, and only on the rolled number', () => {
  const buildings = new Map([
    [cornerA, { city: false, color: 'red' as const }],
    [cornerB, { city: false, color: 'blue' as const }],
  ]);
  // Two seats on the same hex each collect their own; neither sees the other's.
  assert.deepEqual(rollYield(board, buildings, 'red', token, board.robberHex), { [resource]: 1 });
  assert.deepEqual(rollYield(board, buildings, 'blue', token, board.robberHex), { [resource]: 1 });
  assert.deepEqual(rollYield(board, buildings, 'orange', token, board.robberHex), {});
  // A 7 has no token on any hex, so it can never pay out.
  assert.deepEqual(rollYield(board, buildings, 'red', 7, board.robberHex), {});
});

test('the robber hex pays nobody, wherever the robber has been moved to', () => {
  const blocked = board.robberHex;
  const blockedToken = board.hexes[blocked].token;
  const buildings = new Map(hexNodes[blocked].map((n) => [n, { city: true, color: 'red' as const }]));
  // The desert carries no token at all; when the robber sits on a numbered hex, that number
  // still yields nothing.
  assert.deepEqual(rollYield(board, buildings, 'red', blockedToken ?? 8, blocked), {});

  // The robber moves, so blocking follows it rather than the board's starting desert. Park it on
  // the producing hex and the same corners collect nothing; move it away and they pay again.
  const owner = new Map([[cornerA, { city: false, color: 'red' as const }]]);
  assert.deepEqual(rollYield(board, owner, 'red', token, hex), {});
  assert.deepEqual(rollYield(board, owner, 'red', token, blocked), { [resource]: 1 });
});
