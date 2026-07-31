import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGame, registeredGames } from '../registry.ts';
import { edgeNodes, nodeEdges, nodeHexes, NUM_EDGES, NUM_NODES } from './board-topology.ts';
import { BANK_PER_RESOURCE, emptyFreqDeck, NUM_RESOURCES, resourceIndex, TERRAIN_RESOURCE, type CatanAction } from './types.ts';
import { CatanState } from './catan.ts';

function rng(seed = 0x5eed): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const fresh = (n = 4) => new CatanState({ numPlayers: n, rng: rng() });

test('a fresh game opens in initial placement, player 0 to act, not terminal', () => {
  const s = fresh();
  assert.equal(s.isTerminal(), false);
  assert.equal(s.currentPlayer(), 0);
  assert.equal(s.currentPrompt().kind, 'initialSettlement');
  assert.equal(s.isChanceNode(), false);
  assert.deepEqual(s.returns(), [0, 0, 0, 0]);
  assert.equal(s.winner(), -1);
});

test('the bank starts at 19 of each resource; hands are empty; 0 VP', () => {
  const s = fresh();
  assert.deepEqual([...s.bankDeck()], new Array(NUM_RESOURCES).fill(BANK_PER_RESOURCE));
  for (let p = 0; p < 4; p++) {
    assert.equal([...s.handOf(p)].reduce((a, b) => a + b, 0), 0);
    assert.equal(s.victoryPoints(p, true), 0);
  }
  assert.equal(s.robber() >= 0, true);
});

test('the observation shows the seat its own view and never an opponent hand breakdown', () => {
  const s = fresh();
  const obs = s.informationStateString(0);
  assert.match(obs, /You are P0/);
  assert.match(obs, /Opponents:/);
});

test('clone is independent from the original', () => {
  const s = fresh();
  s.applyAction(s.legalActions()[0]);
  const c = s.clone();
  assert.notEqual(c, s);
  assert.equal(c.toString(), s.toString());
  assert.deepEqual(c.legalActions(), s.legalActions(), 'pending road anchor survives the clone');
  c.applyAction(c.legalActions()[0]);
  assert.notEqual(c.toString(), s.toString(), 'advancing the clone does not mutate the original');
});

test('initial settlement choices expose typed production metadata and model-ready text', () => {
  const s = fresh();
  const options = s.initialSettlementOptions();
  assert.equal(options.length, NUM_NODES);
  assert.equal(options.every((option) => option.action.type === 'initialSettlement'), true);
  assert.equal(options.every((option) => option.totalPips >= 0 && option.resourceDiversity >= 0), true);

  const choice = options.reduce((best, option) => (option.totalPips > best.totalPips ? option : best));
  assert.deepEqual(s.actionFromString(`settlement ${choice.node}`), choice.action);
  assert.deepEqual(s.actionFromString(String(choice.node)), choice.action);
  assert.equal(s.actionFromString('settlement 999'), null);

  const observation = s.informationStateString(0);
  assert.match(observation, /Board hexes:/);
  assert.match(observation, new RegExp(`init-settlement ${choice.node}:`));
  assert.match(observation, /total=\d+ pips; diversity=\d/);
});

test('each initial road must touch the settlement just placed', () => {
  const s = fresh();
  const firstSettlement = s.legalActions()[0] as Extract<CatanAction, { type: 'initialSettlement' }>;
  s.applyAction(firstSettlement);
  const firstRoad = s.legalActions()[0] as Extract<CatanAction, { type: 'initialRoad' }>;
  assert.ok(edgeNodes[firstRoad.edge].includes(firstSettlement.node));
  s.applyAction(firstRoad);

  const secondPlayerSettlement = s.legalActions()[0] as Extract<CatanAction, { type: 'initialSettlement' }>;
  s.applyAction(secondPlayerSettlement);
  const legalRoads = s.initialRoadOptions();
  assert.ok(legalRoads.length >= 1);
  assert.ok(legalRoads.every((option) => option.fromNode === secondPlayerSettlement.node));
  assert.ok(legalRoads.every((option) => edgeNodes[option.edge].includes(secondPlayerSettlement.node)));
  assert.ok(legalRoads.every((option) => option.expansionSites.every((site) => site.node !== option.towardNode)));

  const oldSettlementEdge = nodeEdges[firstSettlement.node].find(
    (edge) => s.roadAt(edge) === undefined && !edgeNodes[edge].includes(secondPlayerSettlement.node),
  );
  assert.notEqual(oldSettlementEdge, undefined);
  assert.equal(s.actionFromString(`road ${oldSettlementEdge}`), null);
  assert.throws(() => s.applyAction({ type: 'initialRoad', edge: oldSettlementEdge! }), /Illegal Catan action/);
});

test('initial placement follows the 0→1→2→3→3→2→1→0 snake and grants second-settlement resources', () => {
  const s = fresh();
  const settlementOrder: number[] = [];
  const secondSettlementNodes = new Array<number>(4).fill(-1);
  let actions = 0;

  while (!s.initialPlacementComplete()) {
    const prompt = s.currentPrompt();
    const legal = s.legalActions();
    assert.ok(legal.length > 0, `no legal actions for ${prompt.kind}`);
    const action = legal[0];
    if (action.type === 'initialSettlement') {
      settlementOrder.push(prompt.player);
      if (s.initialSettlementCount(prompt.player) === 1) secondSettlementNodes[prompt.player] = action.node;
    }
    s.applyAction(action);
    actions++;
  }

  assert.equal(actions, 16, '8 settlement choices + 8 road choices');
  assert.deepEqual(settlementOrder, [0, 1, 2, 3, 3, 2, 1, 0]);
  assert.equal(s.currentPlayer(), 0);
  assert.equal(s.currentPrompt().kind, 'roll');
  assert.throws(() => s.legalActions(), /regular turns are not implemented/);

  const buildingsPerSeat = new Array(4).fill(0);
  for (let node = 0; node < NUM_NODES; node++) {
    const building = s.buildingAt(node);
    if (building) buildingsPerSeat[building.player]++;
  }
  const roadsPerSeat = new Array(4).fill(0);
  for (let edge = 0; edge < NUM_EDGES; edge++) {
    const player = s.roadAt(edge);
    if (player !== undefined) roadsPerSeat[player]++;
  }
  assert.deepEqual(buildingsPerSeat, [2, 2, 2, 2]);
  assert.deepEqual(roadsPerSeat, [2, 2, 2, 2]);

  for (let player = 0; player < 4; player++) {
    assert.equal(s.initialSettlementCount(player), 2);
    assert.equal(s.victoryPoints(player, true), 2);
    const expected = emptyFreqDeck();
    for (const hex of nodeHexes[secondSettlementNodes[player]]) {
      const resource = TERRAIN_RESOURCE[s.boardSetup().hexes[hex].terrain];
      if (resource !== null) expected[resourceIndex(resource)]++;
    }
    assert.deepEqual([...s.handOf(player)], expected, `P${player} gets resources around only its second settlement`);
  }

  for (let resource = 0; resource < NUM_RESOURCES; resource++) {
    const total = s.bankDeck()[resource] + [0, 1, 2, 3].reduce((sum, player) => sum + s.handOf(player)[resource], 0);
    assert.equal(total, BANK_PER_RESOURCE, `resource ${resource} remains conserved`);
  }
});

test('the snake works for the supported two-player test variant', () => {
  const s = fresh(2);
  const order: number[] = [];
  while (!s.initialPlacementComplete()) {
    const action = s.legalActions()[0];
    if (action.type === 'initialSettlement') order.push(s.currentPlayer());
    s.applyAction(action);
  }
  assert.deepEqual(order, [0, 1, 1, 0]);
});

test('player count validation rejects unsupported tables', () => {
  assert.throws(() => fresh(1), /2–4 players/);
  assert.throws(() => fresh(5), /2–4 players/);
});

test('catan self-registers in the game registry', () => {
  assert.ok(registeredGames().includes('catan'));
  assert.equal(loadGame('catan').type.shortName, 'catan');
});
