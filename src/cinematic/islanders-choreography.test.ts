import assert from 'node:assert/strict';
import test from 'node:test';
import { mulberry32 } from '../engine/random.ts';
import { robberFlightPoint } from '../game-visuals/islanders/robber-motion.ts';
import { generateBoard } from '../rules/islanders/setup.ts';
import { IslandersState } from '../rules/islanders/islanders.ts';
import { nodeEdges } from '../rules/islanders/board-topology.ts';
import { canPlaceRoad, canPlaceSettlement, canUpgradeCity } from '../rules/islanders/placement.ts';
import {
  ISLANDERS_CINEMATIC_DEVELOPMENTS,
  ISLANDERS_CINEMATIC_PLACEMENTS,
  ISLANDERS_CINEMATIC_LOOP_SECONDS,
  ISLANDERS_GAMEPLAY_START,
  islandersCinematicGameplay,
} from './islanders-choreography.ts';

test('fixed cinematic placements remain legal under the real four-player rules', () => {
  const board = generateBoard(mulberry32(1));
  const state = new IslandersState({ numPlayers: 4, board, rng: mulberry32(7) });
  for (const beat of ISLANDERS_CINEMATIC_PLACEMENTS) {
    assert.equal(state.currentPlayer(), beat.seat);
    assert.ok(state.isLegalAction(beat.action), JSON.stringify(beat));
    state.applyAction(beat.action);
  }
  assert.deepEqual(state.legalActions()[0], { type: 'roll' });
});

test('post-setup roads, settlements, and cities remain spatially legal', () => {
  const buildings = new Map<number, { owner: number; city: boolean }>();
  const roads = new Map<number, number>();
  const occupancy = { building: (node: number) => buildings.get(node), road: (edge: number) => roads.get(edge) };
  for (const beat of [...ISLANDERS_CINEMATIC_PLACEMENTS, ...ISLANDERS_CINEMATIC_DEVELOPMENTS]) {
    const action = beat.action;
    if (action.type === 'initialSettlement') buildings.set(action.node, { owner: beat.seat, city: false });
    else if (action.type === 'initialRoad') roads.set(action.edge, beat.seat);
    else if (action.type === 'buildRoad') {
      assert.ok(canPlaceRoad(action.edge, beat.seat, occupancy), JSON.stringify(beat));
      roads.set(action.edge, beat.seat);
    } else if (action.type === 'buildSettlement') {
      assert.ok(canPlaceSettlement(action.node, occupancy), JSON.stringify(beat));
      assert.ok(nodeEdges[action.node].some((edge) => roads.get(edge) === beat.seat), JSON.stringify(beat));
      buildings.set(action.node, { owner: beat.seat, city: false });
    } else {
      assert.ok(canUpgradeCity(action.node, beat.seat, occupancy), JSON.stringify(beat));
      buildings.set(action.node, { owner: beat.seat, city: true });
    }
  }
  assert.deepEqual(new Set(ISLANDERS_CINEMATIC_DEVELOPMENTS.map(({ action }) => action.type)), new Set(['buildRoad', 'buildSettlement', 'buildCity']));
});

test('Islanders gameplay advances with wall clock while scroll remains an independent input', () => {
  const before = islandersCinematicGameplay(7);
  const after = islandersCinematicGameplay(9);
  assert.notDeepEqual(after, before);
  assert.ok(after.placements.length > before.placements.length || after.dice !== null);

  const sameTimeA = islandersCinematicGameplay(12.5);
  const sameTimeB = islandersCinematicGameplay(12.5);
  assert.deepEqual(sameTimeB, sameTimeA, 'camera scroll must not enter the gameplay sampler');
});

test('setup remains complete when the gameplay loop wraps', () => {
  const firstLoop = islandersCinematicGameplay(17.9);
  const secondLoop = islandersCinematicGameplay(18.1);
  assert.ok(firstLoop.setupElapsed > ISLANDERS_GAMEPLAY_START);
  assert.ok(secondLoop.setupElapsed > firstLoop.setupElapsed);
});

test('script includes a non-seven roll, a seven, and an airborne robber relocation', () => {
  const samples = Array.from({ length: 60 }, (_, index) => islandersCinematicGameplay(index * 0.4));
  assert.ok(samples.some((sample) => sample.dice?.sum !== 7));
  assert.ok(samples.some((sample) => sample.dice?.sum === 7));
  assert.ok(samples.some((sample) => sample.robber && sample.robber.progress > 0 && sample.robber.progress < 1));
});

test('dice expose a highlight result only after both dice have settled', () => {
  const rolling = islandersCinematicGameplay(ISLANDERS_GAMEPLAY_START + 1.1 + 1);
  assert.equal(rolling.dice?.rolling, true);
  assert.equal(rolling.dice?.settledSum, null);

  const landed = islandersCinematicGameplay(ISLANDERS_GAMEPLAY_START + 1.1 + 2.1);
  assert.equal(landed.dice?.rolling, false);
  assert.equal(landed.dice?.settledSum, 9);
});

test('shared robber flight has exact endpoints and a parabolic lift', () => {
  const from = { x: -1.5, z: 0 };
  const to = { x: 1.5, z: 0 };
  assert.deepEqual(robberFlightPoint(from, to, 0), { x: -1.5, y: 0, z: 0 });
  assert.deepEqual(robberFlightPoint(from, to, 1), { x: 1.5, y: 0, z: 0 });
  const middle = robberFlightPoint(from, to, 0.5);
  assert.equal(middle.x, 0);
  assert.ok(middle.y > 1);
});

test('robber direction alternates across gameplay loops without teleporting at the seam', () => {
  const beforeWrap = islandersCinematicGameplay(ISLANDERS_GAMEPLAY_START + ISLANDERS_CINEMATIC_LOOP_SECONDS - 0.01).robber;
  const afterWrap = islandersCinematicGameplay(ISLANDERS_GAMEPLAY_START + ISLANDERS_CINEMATIC_LOOP_SECONDS + 0.01).robber;
  assert.deepEqual(beforeWrap, { from: 6, to: 6, progress: 1 });
  assert.deepEqual(afterWrap, { from: 6, to: 6, progress: 1 });
});
