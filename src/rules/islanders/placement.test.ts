import assert from 'node:assert/strict';
import { test } from 'node:test';
import { edgeNodes, nodeEdges, nodeNodes } from './board-topology.ts';
import { type BoardOccupancy, canPlaceRoad, canPlaceSettlement, canUpgradeCity } from './placement.ts';

// A tiny mutable occupancy over two maps, owners identified by color string.
function occOf(buildings: Map<number, { owner: string; city: boolean }>, roads: Map<number, string>): BoardOccupancy<string> {
  return { building: (n) => buildings.get(n), road: (e) => roads.get(e) };
}

test('settlement: distance rule', () => {
  const buildings = new Map<number, { owner: string; city: boolean }>();
  const occ = occOf(buildings, new Map());
  const node = 0;
  const neighbor = nodeNodes[node][0];

  assert.equal(canPlaceSettlement(node, occ), true); // empty & isolated → ok
  buildings.set(neighbor, { owner: 'blue', city: false });
  assert.equal(canPlaceSettlement(node, occ), false); // adjacent building (any color) blocks
  assert.equal(canPlaceSettlement(neighbor, occ), false); // the occupied node itself
});

test('road: must extend own network, same color only', () => {
  const buildings = new Map<number, { owner: string; city: boolean }>();
  const roads = new Map<number, string>();
  const occ = occOf(buildings, roads);
  const node = 0;
  const edge = nodeEdges[node][0]; // an edge incident to node 0

  assert.equal(canPlaceRoad(edge, 'red', occ), false); // nothing to connect to yet
  buildings.set(node, { owner: 'red', city: false });
  assert.equal(canPlaceRoad(edge, 'red', occ), true); // touches own settlement
  assert.equal(canPlaceRoad(edge, 'blue', occ), false); // not blue's settlement

  // A road extends from an existing same-color road at a shared, empty node.
  roads.set(edge, 'red');
  const far = edgeNodes[edge][0] === node ? edgeNodes[edge][1] : edgeNodes[edge][0];
  const next = nodeEdges[far].find((e) => e !== edge)!;
  assert.equal(canPlaceRoad(next, 'red', occ), true); // red road meets at `far`
  assert.equal(canPlaceRoad(next, 'blue', occ), false); // blue has no road there
  assert.equal(canPlaceRoad(edge, 'red', occ), false); // edge already occupied
});

test('road: cannot route through an enemy building', () => {
  const buildings = new Map<number, { owner: string; city: boolean }>();
  const roads = new Map<number, string>();
  const occ = occOf(buildings, roads);
  const edge = nodeEdges[0][0];
  const [a, b] = edgeNodes[edge];
  const far = a; // treat `a` as the far endpoint carrying the enemy building
  const near = b;

  roads.set(nodeEdges[near].find((e) => e !== edge)!, 'red'); // red network reaches `near`
  buildings.set(far, { owner: 'blue', city: false }); // enemy sits on the far endpoint
  // `edge` connects only via `near` (red road) — allowed; the enemy building on the far side
  // doesn't retroactively block a road that already connects on the near side.
  assert.equal(canPlaceRoad(edge, 'red', occ), true);

  // But a road that would connect ONLY through the enemy-held node is blocked.
  const beyond = nodeEdges[far].find((e) => e !== edge && !occ.road(e))!;
  const otherEnd = edgeNodes[beyond][0] === far ? edgeNodes[beyond][1] : edgeNodes[beyond][0];
  // Ensure the far-side edge's other end offers red no connection.
  if (!occ.building(otherEnd) && !nodeEdges[otherEnd].some((e) => occ.road(e) === 'red')) {
    assert.equal(canPlaceRoad(beyond, 'red', occ), false);
  }
});

test('city: only upgrades own settlement', () => {
  const buildings = new Map<number, { owner: string; city: boolean }>();
  const occ = occOf(buildings, new Map());
  assert.equal(canUpgradeCity(0, 'red', occ), false); // empty
  buildings.set(0, { owner: 'red', city: false });
  assert.equal(canUpgradeCity(0, 'red', occ), true); // own settlement
  assert.equal(canUpgradeCity(0, 'blue', occ), false); // not blue's
  buildings.set(0, { owner: 'red', city: true });
  assert.equal(canUpgradeCity(0, 'red', occ), false); // already a city
});
