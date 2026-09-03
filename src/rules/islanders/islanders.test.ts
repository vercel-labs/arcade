import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGame, registeredGames } from '../registry.ts';
import { edgeNodes, nodeEdges, nodeHexes, NUM_EDGES, NUM_HEXES, NUM_NODES } from './board-topology.ts';
import {
  BANK_PER_RESOURCE,
  COSTS,
  DEV_CARD_TYPES,
  emptyFreqDeck,
  NUM_RESOURCES,
  RESOURCES,
  resourceIndex,
  TERRAIN_RESOURCE,
  type BuildingType,
  type IslandersAction,
  type DevCardType,
  type FreqDeck,
  type Prompt,
  type Resource,
} from './types.ts';
import { IslandersState } from './islanders.ts';

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

const fresh = (n = 4) => new IslandersState({ numPlayers: n, rng: rng() });

function finishSetup(s: IslandersState): void {
  while (!s.initialPlacementComplete()) s.applyAction(s.legalActions()[0]);
}

interface MutableIslanders {
  bank: FreqDeck;
  hands: FreqDeck[];
  devDeck: DevCardType[];
  devHand: number[][];
  boughtDevThisTurn: number[][];
  playedKnights: number[];
  buildings: Map<number, { player: number; type: 'settlement' | 'city' }>;
  roads: Map<number, number>;
  prompt: Prompt;
  turnOwner: number;
  playedDevCardThisTurn: boolean;
  longestRoadHolder: number;
  largestArmyHolder: number;
  recomputeLongestRoad(): void;
  updateLargestArmy(): void;
}

const mutable = (state: IslandersState): MutableIslanders => state as unknown as MutableIslanders;

function setHand(state: IslandersState, player: number, values: Partial<Record<(typeof RESOURCES)[number], number>>): void {
  const hand = emptyFreqDeck();
  for (const resource of RESOURCES) hand[resourceIndex(resource)] = values[resource] ?? 0;
  mutable(state).hands[player] = hand;
}

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
  assert.match(obs, /YOU ARE: player 1/);
  assert.match(obs, /YOUR OPPONENTS ARE: player 2, player 3, player 4/);
  assert.match(obs, /Opponents:/);
});

test('model-facing actions and public history name players instead of exposing P-number aliases', () => {
  const s = new IslandersState({ numPlayers: 2, rng: rng(), seatNames: ['the human player', 'Claude'] });
  finishSetup(s);
  mutable(s).hands[1] = [1, 0, 0, 0, 0];
  s.applyAction({ type: 'roll' }, { dice: [3, 4] });
  const robber = s.legalActions().find((action) => action.type === 'moveRobber' && action.victim === 1);
  assert.ok(robber);
  assert.match(s.actionToString(robber), /steal Claude$/);
  assert.doesNotMatch(s.actionToString(robber), /\bP\d+\b/);
  s.applyAction(robber, { stolenResource: 'brick' });
  const observation = s.informationStateString(0);
  assert.match(observation, /Recent turns/);
  assert.match(observation, /the human player: rolled 7; moved the robber to .* and targeted Claude/);
  assert.doesNotMatch(observation, /\bP\d+\b/);
});

test('model-facing identity block makes actor, opponents, and turn owner explicit', () => {
  const s = new IslandersState({ numPlayers: 3, rng: rng(), seatNames: ['grok-4.1', 'claude-opus-5', 'gpt-5.4'] });
  const view = s.informationStateString(0);
  assert.match(view, /AUTHORITATIVE IDENTITY AND TURN ROLES:/);
  assert.match(view, /YOU ARE: grok-4\.1/);
  assert.match(view, /YOUR OPPONENTS ARE: claude-opus-5, gpt-5\.4/);
  assert.match(view, /PLAYER REQUIRED TO ACT NOW: grok-4\.1 \(YOU\)/);
  assert.doesNotMatch(view, /anthropic\/|openai\/|xai\//);
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

test('initial settlement choices expose typed production metadata and a separate legal decision context', () => {
  const s = fresh();
  const options = s.initialSettlementOptions();
  assert.equal(options.length, NUM_NODES);
  assert.equal(options.every((option) => option.action.type === 'initialSettlement'), true);
  assert.equal(options.every((option) => option.totalPips >= 0 && option.resourceDiversity >= 0), true);
  assert.equal(options.every((option) => option.portfolio.settlementNodes.length === 1), true);

  const choice = options.reduce((best, option) => (option.totalPips > best.totalPips ? option : best));
  assert.deepEqual(s.actionFromString(`settlement ${choice.node}`), choice.action);
  assert.deepEqual(s.actionFromString(String(choice.node)), choice.action);
  assert.equal(s.actionFromString('settlement 999'), null);
  const [distractor, intended] = options;
  assert.deepEqual(
    s.actionFromString(`Node ${distractor.node} was tempting, but init-settlement ${intended.node}`),
    intended.action,
    'descriptive numbers before the canonical action cannot hijack the selected node',
  );

  const observation = s.informationStateString(0);
  assert.match(observation, /Board hexes:/);
  assert.doesNotMatch(observation, /Legal actions/);

  const decision = s.decisionContextString(0);
  assert.match(decision, /Legal actions/);
  assert.match(decision, new RegExp(`init-settlement ${choice.node} \\[public spot:`));
  assert.match(decision, /total=\d+ pips; diversity=\d/);
  assert.match(decision, /brick \/ wheat \(grain\) \/ wood \(lumber\) \/ ore \/ sheep \(wool\)/);
  assert.match(decision, /public hex:/);
  assert.doesNotMatch(decision, /best|recommended/i);
});

test('public Islanders labels are stable, human-readable, and keep canonical IDs separate', () => {
  const s = fresh();
  const nodeLabel = s.publicNodeLabel(0);
  const hexLabel = s.publicHexLabel(0);
  assert.match(nodeLabel, /(?:\d+|desert)(?:🧱|🌾|🪵|🪨|🐑|–|desert)/u);
  assert.match(hexLabel, /^(?:\d+(?:🧱|🌾|🪵|🪨|🐑)|desert)(?: (?:north|northeast|east|southeast|south|southwest|west|northwest)(?: \d+)?)?$/u);
  assert.doesNotMatch(nodeLabel, /\bN\d+\b|\bH\d+\b/);
  assert.equal(s.publicNodeLabel(0), nodeLabel);
  assert.equal(s.publicHexLabel(0), hexLabel);
  assert.equal(new Set(Array.from({ length: NUM_NODES }, (_, node) => s.publicNodeLabel(node))).size, NUM_NODES);
  assert.equal(new Set(Array.from({ length: NUM_HEXES }, (_, hex) => s.publicHexLabel(hex))).size, NUM_HEXES);
});

test('roll decisions distinguish the previous result from the unresolved current roll', () => {
  const s = fresh();
  finishSetup(s);
  const observation = s.informationStateString(0);
  const decision = s.decisionContextString(0);
  assert.match(observation, /Previous resolved dice roll: none/);
  assert.match(observation, /dice have not been rolled for this turn yet/i);
  assert.match(decision, /This roll has no result yet/);
});

test('second-settlement options expose neutral two-settlement portfolio diagnostics', () => {
  const s = fresh();
  while (
    !(
      s.currentPrompt().kind === 'initialSettlement' &&
      s.currentPlayer() === 0 &&
      s.initialSettlementCount(0) === 1
    )
  ) {
    s.applyAction(s.legalActions()[0]);
  }

  const option = s.initialSettlementOptions()[0];
  const portfolio = option.portfolio;
  assert.equal(portfolio.settlementNodes.length, 2);
  assert.equal(portfolio.settlementNodes[1], option.node);
  assert.equal(
    portfolio.totalPips,
    Object.values(portfolio.production).reduce((sum, pips) => sum + (pips ?? 0), 0),
  );
  assert.equal(portfolio.resourceDiversity, Object.keys(portfolio.production).length);
  assert.deepEqual(portfolio.numberCoverage, [...new Set(portfolio.numberCoverage)].sort((a, b) => a - b));
  assert.deepEqual(
    portfolio.startingResources,
    option.adjacentHexes.flatMap((hex) => (hex.resource === null ? [] : [hex.resource])),
  );

  const decision = s.decisionContextString(0);
  assert.match(decision, /two-settlement portfolio:/);
  assert.match(decision, /repeated-numbers=/);
  assert.match(decision, /starting-cards=/);
  assert.match(decision, /ports=/);
});

test('each initial road must touch the settlement just placed', () => {
  const s = fresh();
  const firstSettlement = s.legalActions()[0] as Extract<IslandersAction, { type: 'initialSettlement' }>;
  s.applyAction(firstSettlement);
  const firstRoad = s.legalActions()[0] as Extract<IslandersAction, { type: 'initialRoad' }>;
  const intendedRoad = s.legalActions().at(-1) as Extract<IslandersAction, { type: 'initialRoad' }>;
  assert.deepEqual(
    s.actionFromString(`A 3:1 port is relevant; init-road ${intendedRoad.edge}`),
    intendedRoad,
    'a port ratio before the canonical road cannot become the edge id',
  );
  assert.ok(edgeNodes[firstRoad.edge].includes(firstSettlement.node));
  s.applyAction(firstRoad);

  const secondPlayerSettlement = s.legalActions()[0] as Extract<IslandersAction, { type: 'initialSettlement' }>;
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
  assert.throws(() => s.applyAction({ type: 'initialRoad', edge: oldSettlementEdge! }), /Illegal Islanders action/);
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
  assert.deepEqual(s.legalActions()[0], { type: 'roll' });

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

test('regular turns roll, distribute production, record chance outcomes, and replay deterministically', () => {
  const s = fresh();
  finishSetup(s);
  const before = s.clone();
  const setup = s.boardSetup();
  const producingHex = setup.hexes.findIndex((hex, hexId) =>
    hex.token !== null && Array.from({ length: NUM_NODES }, (_, node) => node).some((node) => nodeHexes[node].includes(hexId) && s.buildingAt(node)),
  );
  assert.notEqual(producingHex, -1);
  const token = setup.hexes[producingHex].token!;
  const firstDie = Math.max(1, token - 6);
  const dice: [number, number] = [firstDie, token - firstDie];
  const priorHands = Array.from({ length: 4 }, (_, player) => [...s.handOf(player)]);

  s.applyAction({ type: 'roll' }, { dice });
  assert.equal(s.currentPrompt().kind, 'playTurn');
  const resource = TERRAIN_RESOURCE[setup.hexes[producingHex].terrain]!;
  const resourceId = resourceIndex(resource);
  for (let player = 0; player < 4; player++) {
    let owed = 0;
    for (let node = 0; node < NUM_NODES; node++) {
      const building = s.buildingAt(node);
      if (building?.player === player && nodeHexes[node].includes(producingHex)) owed += building.type === 'city' ? 2 : 1;
    }
    assert.equal(s.handOf(player)[resourceId] - priorHands[player][resourceId], owed);
  }
  const record = s.actionRecords().at(-1)!;
  assert.deepEqual(record.outcome?.dice, dice);
  before.applyRecordedAction(record);
  assert.equal(before.toString(), s.toString());

  s.applyAction({ type: 'endTurn' });
  before.applyAction({ type: 'endTurn' });
  assert.equal(s.currentPlayer(), 1);
  assert.equal(s.currentPrompt().kind, 'roll');
  s.applyAction({ type: 'roll' });
  before.applyAction({ type: 'roll' });
  assert.deepEqual(before.dice(), s.dice(), 'forced replay advances the chance stream before continuation');
});

test('cloned states consume an identical future random stream independently', () => {
  const original = fresh();
  finishSetup(original);
  const clone = original.clone();
  assert.throws(
    () => original.applyAction({ type: 'roll' }, { dice: [0, 9] }),
    /Invalid recorded dice outcome/,
  );
  original.applyAction({ type: 'roll' });
  clone.applyAction({ type: 'roll' });
  assert.deepEqual(clone.dice(), original.dice());
  assert.equal(clone.toString(), original.toString());
});

test('production honors the bank-shortage rule per resource', () => {
  const shared = fresh();
  finishSetup(shared);
  const sharedState = mutable(shared);
  const hex = shared.boardSetup().hexes.findIndex((candidate) => candidate.token !== null);
  const token = shared.boardSetup().hexes[hex].token!;
  const resource = TERRAIN_RESOURCE[shared.boardSetup().hexes[hex].terrain]!;
  const resourceId = resourceIndex(resource);
  const adjacent = Array.from({ length: NUM_NODES }, (_, node) => node).filter((node) => nodeHexes[node].includes(hex));
  sharedState.buildings.clear();
  sharedState.buildings.set(adjacent[0], { player: 0, type: 'settlement' });
  sharedState.buildings.set(adjacent[1], { player: 1, type: 'settlement' });
  sharedState.hands = Array.from({ length: 4 }, () => emptyFreqDeck());
  sharedState.bank[resourceId] = 1;
  const firstDie = Math.max(1, token - 6);
  shared.applyAction({ type: 'roll' }, { dice: [firstDie, token - firstDie] });
  assert.equal(shared.handOf(0)[resourceId], 0);
  assert.equal(shared.handOf(1)[resourceId], 0);
  assert.equal(shared.bankDeck()[resourceId], 1);

  const solo = fresh();
  finishSetup(solo);
  const soloState = mutable(solo);
  soloState.buildings.clear();
  soloState.buildings.set(adjacent[0], { player: 0, type: 'city' });
  soloState.hands = Array.from({ length: 4 }, () => emptyFreqDeck());
  soloState.bank[resourceId] = 1;
  solo.applyAction({ type: 'roll' }, { dice: [firstDie, token - firstDie] });
  assert.equal(solo.handOf(0)[resourceId], 1, 'a sole claimant takes the remaining supply');
  assert.equal(solo.bankDeck()[resourceId], 0);
});

test('a seven enforces every discard before the roller moves the robber', () => {
  const s = fresh();
  finishSetup(s);
  setHand(s, 0, { brick: 8 });
  setHand(s, 1, { grain: 9 });
  setHand(s, 2, {});
  setHand(s, 3, {});

  s.applyAction({ type: 'roll' }, { dice: [3, 4] });
  assert.deepEqual(s.currentPrompt(), { kind: 'discard', player: 0 });
  assert.ok(s.legalActions().some((action) => action.type === 'discard' && action.resources.length === 4));
  s.applyAction({ type: 'discard', resources: ['brick', 'brick', 'brick', 'brick'] });
  assert.deepEqual(s.currentPrompt(), { kind: 'discard', player: 1 });
  s.applyAction({ type: 'discard', resources: ['grain', 'grain', 'grain', 'grain'] });
  assert.deepEqual(s.currentPrompt(), { kind: 'moveRobber', player: 0 });
  const robber = s.legalActions()[0];
  assert.equal(robber.type, 'moveRobber');
  s.applyAction(robber);
  assert.equal(s.currentPrompt().kind, 'playTurn');
  assert.notEqual(s.robber(), s.boardSetup().robberHex);
});

test('robber choices expose eligible victims and replay validates the stolen resource', () => {
  const s = fresh();
  finishSetup(s);
  setHand(s, 0, {});
  setHand(s, 1, { ore: 1 });
  setHand(s, 2, {});
  setHand(s, 3, {});
  s.applyAction({ type: 'roll' }, { dice: [3, 4] });
  const destination = Array.from({ length: s.boardSetup().hexes.length }, (_, hex) => hex).find((hex) => hex !== s.robber())!;
  const victimNode = Array.from({ length: NUM_NODES }, (_, node) => node).find((node) => nodeHexes[node].includes(destination))!;
  mutable(s).buildings.set(victimNode, { player: 1, type: 'settlement' });
  const action: IslandersAction = { type: 'moveRobber', hex: destination, victim: 1 };
  assert.equal(s.isLegalAction(action), true);
  assert.throws(() => s.applyAction(action, { stolenResource: 'brick' }), /does not hold recorded brick/);
  assert.notEqual(s.robber(), destination, 'invalid replay outcomes do not partially move the robber');
  s.applyAction(action, { stolenResource: 'ore' });
  assert.equal(s.handOf(0)[resourceIndex('ore')], 1);
  assert.equal(s.handOf(1)[resourceIndex('ore')], 0);
});

test('large discard spaces are bounded for enumeration but remain fully valid as a parameterized family', () => {
  const s = fresh();
  finishSetup(s);
  mutable(s).hands[0] = new Array(NUM_RESOURCES).fill(19);
  s.applyAction({ type: 'roll' }, { dice: [3, 4] });
  const legal = s.legalActions();
  assert.equal(legal.length, 256);
  assert.deepEqual(s.legalActionFamilies(), [{ type: 'discard', player: 0, count: 47, available: [19, 19, 19, 19, 19] }]);
  const parameterized: IslandersAction = {
    type: 'discard',
    resources: [
      ...new Array(19).fill('brick'),
      ...new Array(19).fill('grain'),
      ...new Array(9).fill('lumber'),
    ],
  };
  assert.equal(legal.some((action) => JSON.stringify(action) === JSON.stringify(parameterized)), false);
  assert.equal(s.isLegalAction(parameterized), true);
  s.applyAction(parameterized);
  assert.equal(s.handOf(0).reduce((sum, count) => sum + count, 0), 48);
});

test('main phase supports paid building, development-card purchase, and maritime trade', () => {
  const s = fresh();
  finishSetup(s);
  s.applyAction({ type: 'roll' }, { dice: [1, 1] });
  setHand(s, 0, { brick: 10, lumber: 4, grain: 4, wool: 2, ore: 4 });

  const road = s.legalActions().find((action) => action.type === 'buildRoad');
  assert.ok(road);
  const roadsBefore = s.portfolio(0).roadsLeft;
  s.applyAction(road);
  assert.equal(s.portfolio(0).roadsLeft, roadsBefore - 1);

  const openNode = Array.from({ length: NUM_NODES }, (_, node) => node).find(
    (node) =>
      !s.buildingAt(node) &&
      nodeEdges[node].some((edge) => s.roadAt(edge) === undefined) &&
      nodeEdges[node].every((edge) => {
        const [a, b] = edgeNodes[edge];
        return !s.buildingAt(a === node ? b : a);
      }),
  );
  assert.notEqual(openNode, undefined);
  const connectingEdge = nodeEdges[openNode!].find((edge) => s.roadAt(edge) === undefined)!;
  mutable(s).roads.set(connectingEdge, 0);
  const settlement = s.legalActions().find((action) => action.type === 'buildSettlement');
  assert.ok(settlement);
  s.applyAction(settlement);
  assert.equal(s.buildingAt(settlement.node)?.player, 0);

  const city = s.legalActions().find((action) => action.type === 'buildCity');
  assert.ok(city);
  s.applyAction(city);
  assert.equal(s.buildingAt(city.node)?.type, 'city');

  const brickBefore = s.handOf(0)[resourceIndex('brick')];
  const trade = s.legalActions().find(
    (action) => action.type === 'maritimeTrade' && action.give === 'brick' && action.get === 'ore',
  );
  assert.ok(trade);
  s.applyAction(trade);
  const paid = brickBefore - s.handOf(0)[resourceIndex('brick')];
  assert.ok([2, 3, 4].includes(paid));

  const devBefore = s.developmentCardCount(0, 'victoryPoint');
  s.applyAction({ type: 'buyDevCard' }, { developmentCard: 'victoryPoint' });
  assert.equal(s.developmentCardCount(0, 'victoryPoint'), devBefore + 1);
});

test('regular road choices expose compact neutral settlement-frontier facts', () => {
  const s = fresh();
  finishSetup(s);
  s.applyAction({ type: 'roll' }, { dice: [1, 1] });
  setHand(s, 0, { brick: 2, lumber: 2 });
  const decision = s.decisionContextString(0);
  assert.match(decision, /road \d+ \[public route:/);
  assert.match(decision, /settlement expansion — settle now:|future settlement one road away:/);
  assert.match(decision, /not city upgrades/i);
  assert.doesNotMatch(decision, /best road|recommended road/i);
});

test('maritime trades derive exact 4:1, generic 3:1, and matching 2:1 rates for settlements and cities', () => {
  const rateAt = (
    node: number | null,
    type: BuildingType = 'settlement',
    give: Resource = 'brick',
    via: 'bank' | 'port' = 'bank',
  ): number => {
    const s = fresh();
    finishSetup(s);
    s.applyAction({ type: 'roll' }, { dice: [1, 1] });
    const internals = mutable(s);
    internals.buildings.clear();
    if (node !== null) internals.buildings.set(node, { player: 0, type });
    setHand(s, 0, { [give]: 4 });
    const get = RESOURCES.find((resource) => resource !== give)!;
    const before = s.handOf(0)[resourceIndex(give)];
    const action = s.legalActions().find(
      (candidate) => candidate.type === 'maritimeTrade' && candidate.via === via && candidate.give === give && candidate.get === get,
    );
    assert.ok(action);
    s.applyAction(action);
    return before - s.handOf(0)[resourceIndex(give)];
  };
  const board = fresh().boardSetup();
  const harborNodes = new Set(board.harbors.flatMap((harbor) => harbor.nodes));
  const plainNode = Array.from({ length: NUM_NODES }, (_, node) => node).find((node) => !harborNodes.has(node))!;
  const genericHarbor = board.harbors.find((harbor) => harbor.port.resource === null)!;
  const brickHarbor = board.harbors.find((harbor) => harbor.port.resource === 'brick')!;
  const genericNode = genericHarbor.nodes[0];
  const brickNode = brickHarbor.nodes[0];
  assert.equal(rateAt(plainNode), 4);
  for (const resource of RESOURCES) assert.equal(rateAt(genericNode, 'settlement', resource, 'port'), 3);
  assert.equal(rateAt(brickHarbor.nodes[0], 'settlement', 'brick', 'port'), 2);
  assert.equal(rateAt(brickHarbor.nodes[1], 'settlement', 'brick', 'port'), 2);
  assert.equal(rateAt(brickNode, 'settlement', 'grain'), 4);
  assert.equal(rateAt(genericNode, 'city', 'brick', 'port'), 3);
  assert.equal(rateAt(brickNode, 'city', 'brick', 'port'), 2);
  assert.equal(rateAt(genericNode, 'settlement', 'brick', 'bank'), 4, 'owning a port leaves 4:1 bank trade available');

  const channels = fresh();
  finishSetup(channels);
  channels.applyAction({ type: 'roll' }, { dice: [1, 1] });
  mutable(channels).buildings.clear();
  mutable(channels).buildings.set(genericNode, { player: 0, type: 'settlement' });
  setHand(channels, 0, { brick: 4 });
  const brickForOre = channels.legalActions().filter(
    (action) => action.type === 'maritimeTrade' && action.give === 'brick' && action.get === 'ore',
  );
  assert.deepEqual(brickForOre.map((action) => action.type === 'maritimeTrade' && action.via), ['port', 'bank']);
  assert.deepEqual(channels.actionFromString('port-trade brick->ore'), brickForOre[0]);
  assert.deepEqual(channels.actionFromString('bank-trade brick->ore'), brickForOre[1]);

  mutable(channels).buildings.set(brickNode, { player: 0, type: 'settlement' });
  const brickChoices = channels.legalActions().filter(
    (action) => action.type === 'maritimeTrade' && action.give === 'brick' && action.get === 'ore',
  );
  assert.deepEqual(brickChoices.map((action) => action.type === 'maritimeTrade' && (
    action.via === 'bank' ? 'bank 4:1' : `port ${action.rate}:1`
  )), ['port 2:1', 'port 3:1', 'bank 4:1']);
  assert.deepEqual(channels.actionFromString('port-trade 2:1 brick->ore'), brickChoices[0]);
  assert.deepEqual(channels.actionFromString('port-trade 3:1 brick->ore'), brickChoices[1]);

  setHand(channels, 0, { brick: 12 });
  const bulkChoices: IslandersAction[] = [
    { type: 'maritimeBulkTrade', via: 'port', rate: 2, give: 'brick', gets: ['ore', 'wool'] },
    { type: 'maritimeBulkTrade', via: 'port', rate: 3, give: 'brick', gets: ['ore', 'wool'] },
    { type: 'maritimeBulkTrade', via: 'bank', give: 'brick', gets: ['ore', 'wool'] },
  ];
  for (const action of bulkChoices) assert.equal(channels.isLegalAction(action), true, channels.actionToString(action));
  const bulk = channels.clone() as IslandersState;
  bulk.applyAction(bulkChoices[0]);
  assert.equal(bulk.handOf(0)[resourceIndex('brick')], 8);
  assert.equal(bulk.handOf(0)[resourceIndex('ore')], 1);
  assert.equal(bulk.handOf(0)[resourceIndex('wool')], 1);
  assert.equal(channels.isLegalAction({ type: 'maritimeBulkTrade', via: 'port', rate: 2, give: 'brick', gets: ['brick'] }), false);

  const rates = fresh();
  const internals = mutable(rates);
  internals.buildings.clear();
  internals.buildings.set(genericNode, { player: 0, type: 'settlement' });
  internals.buildings.set(brickNode, { player: 0, type: 'city' });
  assert.deepEqual(rates.maritimeTradeRates(0), {
    brick: 2,
    grain: 3,
    lumber: 3,
    ore: 3,
    wool: 3,
  });
  assert.deepEqual(rates.maritimePortTradeRates(0), {
    brick: [2, 3],
    grain: [3],
    lumber: [3],
    ore: [3],
    wool: [3],
  });

});

test('maritime trades require bank supply', () => {
  const emptyBank = fresh();
  finishSetup(emptyBank);
  emptyBank.applyAction({ type: 'roll' }, { dice: [1, 1] });
  setHand(emptyBank, 0, { brick: 19 });
  mutable(emptyBank).bank[resourceIndex('ore')] = 0;
  assert.equal(
    emptyBank.legalActions().some(
      (action) => action.type === 'maritimeTrade' && action.give === 'brick' && action.get === 'ore',
    ),
    false,
  );
});

test('piece pools, city replacement, and an exhausted development deck constrain purchases', () => {
  const s = fresh();
  finishSetup(s);
  s.applyAction({ type: 'roll' }, { dice: [1, 1] });
  const internals = mutable(s);
  internals.buildings.clear();
  for (let node = 0; node < 5; node++) internals.buildings.set(node, { player: 0, type: 'settlement' });
  internals.roads.clear();
  for (let edge = 0; edge < 15; edge++) internals.roads.set(edge, 0);
  setHand(s, 0, { brick: 19, grain: 19, lumber: 19, ore: 19, wool: 19 });
  assert.equal(s.legalActions().some((action) => action.type === 'buildSettlement'), false);
  assert.equal(s.legalActions().some((action) => action.type === 'buildRoad'), false);
  const city = s.legalActions().find((action) => action.type === 'buildCity')!;
  s.applyAction(city);
  assert.equal(s.portfolio(0).settlementsLeft, 1, 'upgrading returns the replaced settlement to supply');
  assert.equal(s.portfolio(0).citiesLeft, 3);
  internals.devDeck.length = 0;
  assert.equal(s.legalActions().some((action) => action.type === 'buyDevCard'), false);
});

function mainPhaseWithDev(type: Exclude<DevCardType, 'victoryPoint'>): IslandersState {
  const s = fresh();
  finishSetup(s);
  s.applyAction({ type: 'roll' }, { dice: [1, 1] });
  const internals = mutable(s);
  internals.devHand[0][DEV_CARD_TYPES.indexOf(type)] = 1;
  return s;
}

test('the outlook states what each build still needs and where the awards stand, and can be switched off', () => {
  const s = fresh();
  finishSetup(s);
  s.applyAction({ type: 'roll' }, { dice: [1, 1] });
  setHand(s, 0, { lumber: 1, brick: 1 });
  const text = s.informationStateString(0);
  assert.match(text, /Your outlook \(facts, not advice\):/);
  assert.match(text, /- Victory: 2 VP counting hidden cards; 8 more to win\./);
  assert.match(text, /- Settlement \(need 1 wheat, 1 sheep\): (spots you can take now: |no spot reachable yet)/);
  assert.match(text, /- City \(need 2 wheat, 3 ore\): settlements you can upgrade: /);
  assert.match(text, /- Road \(affordable now\); development card \(need 1 wheat, 1 ore, 1 sheep\), 25 left in the deck\./);
  assert.match(text, /- Longest Road: yours is 1; no one holds it yet \(5 needed\)\./);
  assert.match(text, /- Largest Army: you have played 0 knights; no one holds it yet \(3 needed\)\./);
  assert.ok(text.indexOf('Your outlook') > text.indexOf('Your portfolio'), 'the outlook follows the portfolio line');
  assert.equal(s.clone().informationStateString(0).includes('Your outlook'), true, 'clones keep the setting');

  const quiet = new IslandersState({ numPlayers: 4, rng: rng(), promptOutlook: false });
  finishSetup(quiet);
  assert.equal(quiet.informationStateString(0).includes('Your outlook'), false);
});

test('a held development card explains why it cannot be played yet', () => {
  const s = mainPhaseWithDev('knight');
  assert.equal(s.developmentCardHold(0, 'knight'), null);
  assert.equal(s.developmentCardHold(0, 'monopoly'), null, 'holding none is not a hold');
  mutable(s).devHand[0][DEV_CARD_TYPES.indexOf('monopoly')] = 1;
  mutable(s).boughtDevThisTurn[0][DEV_CARD_TYPES.indexOf('monopoly')] = 1;
  assert.equal(s.developmentCardHold(0, 'monopoly'), 'boughtThisTurn');
  s.applyAction(s.legalActions().find((action) => action.type === 'playKnight')!);
  mutable(s).devHand[0][DEV_CARD_TYPES.indexOf('knight')] = 1;
  assert.equal(s.developmentCardHold(0, 'knight'), 'alreadyPlayed');
  s.applyAction({ type: 'endTurn' });
  assert.equal(s.developmentCardHold(0, 'knight'), 'notYourTurn');
  assert.equal(s.developmentCardHold(0, 'monopoly'), 'notYourTurn', 'the purchase gate lifts with the turn');
});

test('all playable development cards execute and the one-card-per-turn/new-card gates hold', () => {
  const preRoll = fresh();
  finishSetup(preRoll);
  mutable(preRoll).devHand[0][DEV_CARD_TYPES.indexOf('knight')] = 1;
  const preRollKnight = preRoll.legalActions().find((action) => action.type === 'playKnight')!;
  preRoll.applyAction(preRollKnight);
  assert.equal(preRoll.currentPrompt().kind, 'roll', 'a development card may be played before rolling');

  const knight = mainPhaseWithDev('knight');
  const knightAction = knight.legalActions().find((action) => action.type === 'playKnight')!;
  knight.applyAction(knightAction);
  assert.equal(knight.playedKnightCount(0), 1);
  assert.equal(knight.legalActions().some((action) => action.type.startsWith('play')), false);

  const roads = mainPhaseWithDev('roadBuilding');
  const roadAction = roads.legalActions().find((action) => action.type === 'playRoadBuilding')!;
  const roadCount = roads.portfolio(0).roadsLeft;
  roads.applyAction(roadAction);
  assert.equal(roads.portfolio(0).roadsLeft, roadCount - roadAction.edges.length);

  const plenty = mainPhaseWithDev('yearOfPlenty');
  const plentyAction = plenty.legalActions().find(
    (action) => action.type === 'playYearOfPlenty' && action.resources.length === 2,
  )!;
  const cardsBefore = plenty.handOf(0).reduce((sum, count) => sum + count, 0);
  plenty.applyAction(plentyAction);
  assert.equal(plenty.handOf(0).reduce((sum, count) => sum + count, 0), cardsBefore + 2);

  const scarcePlenty = mainPhaseWithDev('yearOfPlenty');
  mutable(scarcePlenty).bank.fill(0);
  mutable(scarcePlenty).bank[resourceIndex('wool')] = 1;
  const scarceAction = scarcePlenty.legalActions().find((action) => action.type === 'playYearOfPlenty')!;
  assert.deepEqual(scarceAction, { type: 'playYearOfPlenty', resources: ['wool'] });
  scarcePlenty.applyAction(scarceAction);

  const monopoly = mainPhaseWithDev('monopoly');
  setHand(monopoly, 1, { ore: 2 });
  setHand(monopoly, 2, { ore: 3 });
  monopoly.applyAction({ type: 'playMonopoly', resource: 'ore' });
  assert.equal(monopoly.handOf(0)[resourceIndex('ore')], 5);
  assert.equal(monopoly.handOf(1)[resourceIndex('ore')], 0);
  assert.equal(monopoly.handOf(2)[resourceIndex('ore')], 0);

  const newlyBought = mainPhaseWithDev('monopoly');
  mutable(newlyBought).boughtDevThisTurn[0][DEV_CARD_TYPES.indexOf('monopoly')] = 1;
  assert.equal(newlyBought.legalActions().some((action) => action.type === 'playMonopoly'), false);
});

test('domestic trade is parameterized, sequentially accepted, and atomically confirmed', () => {
  const s = new IslandersState({ numPlayers: 4, rng: rng(), domesticTrade: true });
  finishSetup(s);
  s.applyAction({ type: 'roll' }, { dice: [1, 1] });
  setHand(s, 0, { brick: 1 });
  setHand(s, 1, { grain: 1 });
  setHand(s, 2, {});
  setHand(s, 3, {});
  assert.deepEqual(s.legalActionFamilies(), [{ type: 'offerTrade', player: 0, resourceOrder: RESOURCES }]);
  assert.deepEqual(s.parameterizedActionExamples(), [
    { type: 'offerTrade', give: [1, 0, 0, 0, 0], receive: [0, 1, 0, 0, 0] },
  ]);
  const offer = s.actionFromString('offer 1/0/0/0/0 for 0/1/0/0/0');
  assert.deepEqual(offer, { type: 'offerTrade', give: [1, 0, 0, 0, 0], receive: [0, 1, 0, 0, 0] });
  s.applyAction(offer!);
  assert.deepEqual(s.currentPrompt(), { kind: 'respondTrade', player: 1 });
  s.applyAction({ type: 'acceptTrade' });
  s.applyAction({ type: 'rejectTrade' });
  s.applyAction({ type: 'rejectTrade' });
  assert.deepEqual(s.currentPrompt(), { kind: 'decideAcceptees', player: 0 });
  s.applyAction({ type: 'confirmTrade', with: 1 });
  assert.equal(s.handOf(0)[resourceIndex('grain')], 1);
  assert.equal(s.handOf(1)[resourceIndex('brick')], 1);
  assert.equal(s.currentPrompt().kind, 'playTurn');
});

test('domestic trade responders can revise an offer and the proposer can confirm that counter', () => {
  const s = new IslandersState({ numPlayers: 4, rng: rng(), domesticTrade: true });
  finishSetup(s);
  s.applyAction({ type: 'roll' }, { dice: [1, 1] });
  setHand(s, 0, { brick: 2 });
  setHand(s, 1, { grain: 2 });
  setHand(s, 2, { grain: 1 });
  setHand(s, 3, {});

  s.applyAction({ type: 'offerTrade', give: [1, 0, 0, 0, 0], receive: [0, 1, 0, 0, 0] });
  assert.deepEqual(s.legalActionFamilies(), [{ type: 'counterTrade', player: 1, resourceOrder: RESOURCES }]);
  assert.deepEqual(s.parameterizedActionExamples(), [
    { type: 'counterTrade', give: [0, 1, 0, 0, 0], receive: [1, 0, 0, 0, 0] },
  ]);
  assert.match(s.decisionContextString(1), /Counteroffer \(parameterized\)/);
  const counter = s.actionFromString('counter 0/2/0/0/0 for 1/0/0/0/0');
  assert.deepEqual(counter, { type: 'counterTrade', give: [0, 2, 0, 0, 0], receive: [1, 0, 0, 0, 0] });
  s.applyAction(counter!);
  s.applyAction({ type: 'acceptTrade' });
  s.applyAction({ type: 'rejectTrade' });

  assert.deepEqual(s.currentPrompt(), { kind: 'decideAcceptees', player: 0 });
  assert.deepEqual(s.activeTrade()?.counters, [
    { from: 1, give: [0, 2, 0, 0, 0], receive: [1, 0, 0, 0, 0] },
  ]);
  assert.match(s.informationStateString(0), /COUNTER FROM player 2: player 2 gives 2 wheat and receives 1 brick/);
  assert.equal(s.legalActions().some((action) => action.type === 'confirmTrade' && action.with === 1), true);
  assert.equal(s.legalActions().some((action) => action.type === 'confirmTrade' && action.with === 2), true);

  s.applyAction({ type: 'confirmTrade', with: 1 });
  assert.equal(s.handOf(0)[resourceIndex('brick')], 1);
  assert.equal(s.handOf(0)[resourceIndex('grain')], 2);
  assert.equal(s.handOf(1)[resourceIndex('brick')], 1);
  assert.equal(s.handOf(1)[resourceIndex('grain')], 0);
  assert.equal(s.currentPrompt().kind, 'playTurn');
});

test('a submitted counteroffer can be withdrawn only by its owner while the trade is unresolved', () => {
  const s = new IslandersState({ numPlayers: 3, domesticTrade: true, rng: rng() });
  finishSetup(s);
  s.applyAction({ type: 'roll' });
  setHand(s, 0, { brick: 2 });
  setHand(s, 1, { grain: 2 });
  s.applyAction({ type: 'offerTrade', give: [1, 0, 0, 0, 0], receive: [0, 1, 0, 0, 0] });
  s.applyAction({ type: 'counterTrade', give: [0, 2, 0, 0, 0], receive: [1, 0, 0, 0, 0] });
  assert.equal(s.withdrawCounterOffer(0), false, 'the original offerer cannot withdraw another response');
  assert.equal(s.withdrawCounterOffer(1), true);
  assert.equal(s.activeTrade()?.counters.length, 0);
  assert.equal(s.withdrawCounterOffer(1), false, 'the same counter cannot be withdrawn twice');
});

test('domestic trade prompts state exact offerer, responder, and confirmation perspectives', () => {
  const s = new IslandersState({ numPlayers: 2, rng: rng(), domesticTrade: true });
  finishSetup(s);
  s.applyAction({ type: 'roll' }, { dice: [1, 1] });
  setHand(s, 0, { brick: 1 });
  setHand(s, 1, { grain: 2 });
  s.applyAction({ type: 'offerTrade', give: [1, 0, 0, 0, 0], receive: [0, 1, 0, 0, 0] });
  const responder = s.informationStateString(1) + '\n' + s.decisionContextString(1);
  assert.match(responder, /OFFERER: player 1/);
  assert.match(responder, /ORIGINAL OFFER: player 1 gives 1 brick and receives 1 wheat/);
  assert.match(responder, /IF YOU ACCEPT: YOU give 1 wheat to player 1; YOU receive 1 brick from player 1/);
  assert.match(responder, /accept \[YOU give 1 wheat; YOU receive 1 brick from player 1\]/);
  s.applyAction({ type: 'counterTrade', give: [0, 2, 0, 0, 0], receive: [1, 0, 0, 0, 0] });
  const offerer = s.decisionContextString(0);
  assert.match(offerer, /confirm counter with player 2: YOU give 1 brick; YOU receive 2 wheat/);
});

test('an optional AI-table offer budget prevents unchanged domestic-trade loops and resets next turn', () => {
  const s = new IslandersState({ numPlayers: 2, rng: rng(), domesticTrade: true, domesticTradeOfferLimit: 1 });
  finishSetup(s);
  s.applyAction({ type: 'roll' }, { dice: [1, 1] });
  setHand(s, 0, { brick: 1 });
  setHand(s, 1, { grain: 1 });
  const offer: IslandersAction = { type: 'offerTrade', give: [1, 0, 0, 0, 0], receive: [0, 1, 0, 0, 0] };
  s.applyAction(offer);
  s.applyAction({ type: 'rejectTrade' });
  s.applyAction({ type: 'cancelTrade' });
  assert.equal(s.isLegalAction(offer), false);
  assert.deepEqual(s.legalActionFamilies(), []);
  s.applyAction({ type: 'endTurn' });
  s.applyAction({ type: 'roll' }, { dice: [1, 1] });
  assert.deepEqual(s.legalActionFamilies(), [{ type: 'offerTrade', player: 1, resourceOrder: RESOURCES }]);
});

test('a per-seat offer policy caps and de-duplicates one seat while the other negotiates freely', () => {
  const s = new IslandersState({
    numPlayers: 2,
    rng: rng(),
    domesticTrade: true,
    seatNames: ['claude', 'the human player'],
    domesticTradePolicy: [{ maxOffersPerTurn: 2, noRepeatRefused: true }, undefined],
  });
  finishSetup(s);
  s.applyAction({ type: 'roll' }, { dice: [1, 1] });
  setHand(s, 0, { brick: 3 });
  setHand(s, 1, { grain: 3 });
  const offer: IslandersAction = { type: 'offerTrade', give: [1, 0, 0, 0, 0], receive: [0, 1, 0, 0, 0] };
  const other: IslandersAction = { type: 'offerTrade', give: [2, 0, 0, 0, 0], receive: [0, 1, 0, 0, 0] };
  s.applyAction(offer);
  s.applyAction({ type: 'rejectTrade' });
  s.applyAction({ type: 'cancelTrade' });
  // The same offer is refused for this seat; a changed one is still open (1 of 2 used).
  assert.equal(s.isLegalAction(offer), false);
  assert.equal(s.actionFromString('offer 1/0/0/0/0 for 0/1/0/0/0'), null);
  assert.match(s.actionRejectionNote('offer 1/0/0/0/0 for 0/1/0/0/0') ?? '', /already refused this turn/);
  assert.equal(s.actionRejectionNote('offer 2/0/0/0/0 for 0/1/0/0/0'), null);
  assert.equal(s.isLegalAction(other), true);
  assert.equal(s.offersRemainingThisTurn(0), 1);
  const context = s.decisionContextString(0);
  assert.match(context, /Offers you made this turn \(1 of 2 used\)/);
  assert.match(context, /you offered 1 brick for 1 wheat: rejected by the human player → no deal/);
  assert.match(context, /Do not post the same offer again/);
  assert.match(context, /You have 1 offer left this turn/);
  s.applyAction(other);
  s.applyAction({ type: 'rejectTrade' });
  s.applyAction({ type: 'cancelTrade' });
  assert.deepEqual(s.legalActionFamilies(), []);
  assert.match(s.actionRejectionNote('offer 1/0/0/0/0 for 0/1/0/0/0') ?? '', /used every domestic offer/);
  assert.match(s.decisionContextString(0), /2 offers have been turned down this turn/);
  assert.match(s.decisionContextString(0), /no offers left this turn/);
  // The observation carries the collapsed story and the reciprocity tally.
  const view = s.informationStateString(0);
  assert.match(view, /Recent turns/);
  assert.match(view, /offered 1 brick for 1 wheat \(rejected by the human player → no deal\)/);
  assert.match(view, /the human player: you offered them 2 trades \(accepted 0, countered 0, rejected 2; 0 completed\)/);
  s.applyAction({ type: 'endTurn' });
  // The human seat has no policy: it may repeat itself and is never capped.
  s.applyAction({ type: 'roll' }, { dice: [1, 1] });
  const humanOffer: IslandersAction = { type: 'offerTrade', give: [0, 1, 0, 0, 0], receive: [1, 0, 0, 0, 0] };
  s.applyAction(humanOffer);
  s.applyAction({ type: 'rejectTrade' });
  s.applyAction({ type: 'cancelTrade' });
  assert.equal(s.isLegalAction(humanOffer), true);
  assert.equal(s.offersRemainingThisTurn(1), Number.POSITIVE_INFINITY);
  assert.match(s.informationStateString(1), /claude: you offered them 1 trade .*; they offered 2 \(you accepted 0, countered 0, rejected 2; 0 completed\)/);
});

test('domestic trading is disabled by default and regular parsing binds the final named action', () => {
  const disabled = fresh();
  finishSetup(disabled);
  disabled.applyAction({ type: 'roll' }, { dice: [1, 1] });
  setHand(disabled, 0, { brick: 1 });
  assert.equal(disabled.actionFromString('offer 1/0/0/0/0 for 0/1/0/0/0'), null);
  assert.deepEqual(disabled.legalActionFamilies(), []);

  const monopoly = mainPhaseWithDev('monopoly');
  assert.deepEqual(
    monopoly.actionFromString('monopoly brick was tempting; my final move is monopoly ore'),
    { type: 'playMonopoly', resource: 'ore' },
  );
});

test('special awards, hidden victory points, and model observations preserve public/private boundaries', () => {
  const s = fresh();
  finishSetup(s);
  const internals = mutable(s);
  internals.buildings.clear();
  const path: number[] = [];
  const search = (node: number, used: Set<number>): boolean => {
    if (path.length === 5) return true;
    for (const edge of nodeEdges[node]) {
      if (used.has(edge)) continue;
      used.add(edge);
      path.push(edge);
      const [a, b] = edgeNodes[edge];
      if (search(a === node ? b : a, used)) return true;
      path.pop();
      used.delete(edge);
    }
    return false;
  };
  assert.equal(search(0, new Set()), true);
  internals.roads.clear();
  for (const edge of path) internals.roads.set(edge, 0);
  internals.recomputeLongestRoad();
  assert.equal(s.longestRoad(), 0);
  assert.equal(s.roadLength(0), 5);

  internals.playedKnights[0] = 3;
  internals.updateLargestArmy();
  assert.equal(s.largestArmy(), 0);

  internals.buildings.clear();
  for (let node = 0; node < 4; node++) internals.buildings.set(node, { player: 0, type: 'city' });
  internals.longestRoadHolder = -1;
  internals.largestArmyHolder = -1;
  internals.buildings.set(4, { player: 0, type: 'settlement' });
  internals.prompt = { kind: 'playTurn', player: 0 };
  internals.turnOwner = 0;
  setHand(s, 0, { grain: 1, wool: 1, ore: 1 });
  s.applyAction({ type: 'buyDevCard' }, { developmentCard: 'victoryPoint' });
  assert.equal(s.victoryPoints(0, false), 9);
  assert.equal(s.victoryPoints(0, true), 10);
  assert.equal(s.winner(), 0);
  assert.equal(s.isTerminal(), true);
  assert.deepEqual(s.returns(), [1, -1, -1, -1]);

  const opponentView = s.informationStateString(1);
  assert.match(opponentView, /player 1: 9 public VP/);
  assert.doesNotMatch(opponentView, /player 1.*victoryPoint/);
});

test('ten points acquired off-turn are claimed only when that seat becomes turn owner', () => {
  const s = fresh();
  finishSetup(s);
  s.applyAction({ type: 'roll' }, { dice: [1, 1] });
  const internals = mutable(s);
  internals.buildings.clear();
  for (let node = 0; node < 4; node++) internals.buildings.set(node, { player: 1, type: 'city' });
  internals.buildings.set(4, { player: 1, type: 'settlement' });
  internals.devHand[1][DEV_CARD_TYPES.indexOf('victoryPoint')] = 1;
  assert.equal(s.victoryPoints(1, true), 10);
  assert.equal(s.isTerminal(), false);
  s.applyAction({ type: 'endTurn' });
  assert.equal(s.isTerminal(), true);
  assert.equal(s.winner(), 1);
});

test('special-card ties retain the holder, strict leaders transfer, and an enemy building splits a road', () => {
  const s = fresh();
  finishSetup(s);
  const internals = mutable(s);
  internals.buildings.clear();
  internals.roads.clear();
  const findTrail = (length: number, forbidden = new Set<number>()): { edges: number[]; nodes: number[] } => {
    const edges: number[] = [];
    const nodes: number[] = [];
    const walk = (node: number, used: Set<number>): boolean => {
      nodes.push(node);
      if (edges.length === length) return true;
      for (const edge of nodeEdges[node]) {
        if (used.has(edge) || forbidden.has(edge)) continue;
        used.add(edge);
        edges.push(edge);
        const [a, b] = edgeNodes[edge];
        if (walk(a === node ? b : a, used)) return true;
        edges.pop();
        used.delete(edge);
      }
      nodes.pop();
      return false;
    };
    for (let start = 0; start < NUM_NODES; start++) {
      edges.length = 0;
      nodes.length = 0;
      if (walk(start, new Set())) return { edges: [...edges], nodes: [...nodes] };
    }
    throw new Error(`No trail of length ${length}`);
  };
  const p0 = findTrail(5);
  const p1 = findTrail(6, new Set(p0.edges));
  for (const edge of p0.edges) internals.roads.set(edge, 0);
  internals.recomputeLongestRoad();
  assert.equal(s.longestRoad(), 0);
  for (const edge of p1.edges.slice(0, 5)) internals.roads.set(edge, 1);
  internals.recomputeLongestRoad();
  assert.equal(s.longestRoad(), 0, 'the holder keeps Longest Road on a tie');
  internals.roads.set(p1.edges[5], 1);
  internals.recomputeLongestRoad();
  assert.equal(s.longestRoad(), 1, 'a strictly longer road transfers the award');
  internals.buildings.set(p0.nodes[2], { player: 2, type: 'settlement' });
  internals.recomputeLongestRoad();
  assert.ok(s.roadLength(0) < 5, 'an enemy settlement interrupts traversal through its node');

  internals.playedKnights.fill(0);
  internals.playedKnights[0] = 3;
  internals.updateLargestArmy();
  internals.playedKnights[1] = 3;
  internals.updateLargestArmy();
  assert.equal(s.largestArmy(), 0, 'the holder keeps Largest Army on a tie');
  internals.playedKnights[1] = 4;
  internals.updateLargestArmy();
  assert.equal(s.largestArmy(), 1);
});

test('seeded random full games reach a winner without dead ends or resource drift', () => {
  for (let seed = 1; seed <= 5; seed++) {
    const random = rng(seed);
    const s = new IslandersState({ numPlayers: 4, rng: random });
    let actions = 0;
    while (!s.isTerminal() && actions < 5_000) {
      const legal = s.legalActions();
      assert.ok(legal.length > 0, `seed ${seed} dead-ended at ${s.currentPrompt().kind}`);
      let index = Math.floor(random() * legal.length);
      if (s.currentPrompt().kind === 'playTurn' && legal.length > 1 && legal[index].type === 'endTurn') {
        index = 1 + Math.floor(random() * (legal.length - 1));
      }
      s.applyAction(legal[index]);
      for (let resource = 0; resource < NUM_RESOURCES; resource++) {
        const total = s.bankDeck()[resource] + Array.from({ length: 4 }, (_, player) => s.handOf(player)[resource]).reduce((a, b) => a + b, 0);
        assert.equal(total, BANK_PER_RESOURCE, `seed ${seed}, action ${actions}, resource ${resource}`);
      }
      actions++;
    }
    assert.equal(s.isTerminal(), true, `seed ${seed} failed to finish in ${actions} actions`);
    assert.ok(s.winner() >= 0);
  }
});

test('a transcript contains its initial world and replays without an external UI snapshot', () => {
  const s = fresh();
  finishSetup(s);
  s.applyAction({ type: 'roll' }, { dice: [2, 3] });
  s.applyAction({ type: 'endTurn' });
  const transcript = s.transcript();
  const replay = IslandersState.replay(transcript, rng(999));
  assert.deepEqual(replay.boardSetup(), s.boardSetup());
  assert.equal(replay.toString(), s.toString());
  assert.deepEqual(replay.actionRecords(), s.actionRecords());
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

test('islanders self-registers in the game registry', () => {
  assert.ok(registeredGames().includes('islanders'));
  assert.equal(loadGame('islanders').type.shortName, 'islanders');
});
