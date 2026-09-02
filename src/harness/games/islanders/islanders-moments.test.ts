import assert from 'node:assert/strict';
import test from 'node:test';
import type { IslandersState } from '../../../rules/islanders/islanders.ts';
import { reactionOpportunities } from '../../communication/moments.ts';
import { detectIslandersMoments } from './islanders-moments.ts';

function state(values: { vp?: number[]; longest?: number; army?: number }): IslandersState {
  return {
    n: values.vp?.length ?? 2,
    victoryPoints: (seat: number) => values.vp?.[seat] ?? 0,
    longestRoad: () => values.longest ?? -1,
    largestArmy: () => values.army ?? -1,
    roadAt: () => undefined,
    publicNodeLabel: (node: number) => `spot-${node}`,
    publicHexLabel: (hex: number) => `hex-${hex}`,
  } as unknown as IslandersState;
}

test('Islanders moments detect visible win pressure and select an opponent reaction', () => {
  const moments = detectIslandersMoments(
    state({ vp: [7, 5, 4] }),
    { type: 'buildCity', node: 3 },
    state({ vp: [9, 5, 4] }),
    0,
    42,
    ['Red', 'Blue', 'Orange'],
  );
  assert.equal(moments[0]?.type, 'imminent_win');
  assert.equal(moments[0]?.importance, 0.98);
  assert.deepEqual(reactionOpportunities(moments[0], 1).map((item) => item.seat), [1]);
});

test('Islanders moments detect award transfers as dramatic public events', () => {
  const moments = detectIslandersMoments(
    state({ vp: [5, 6], longest: 1 }),
    { type: 'buildRoad', edge: 0 },
    state({ vp: [7, 4], longest: 0 }),
    0,
    70,
    ['Red', 'Blue'],
  );
  assert.ok(moments.some((moment) => moment.type === 'longest_road_changed' && moment.affectedSeats[0] === 1));
});

test('reaction moments preserve model-facing actor identity instead of UI second person', () => {
  const moments = detectIslandersMoments(
    state({ vp: [2, 2] }),
    { type: 'moveRobber', hex: 3, victim: 1 },
    state({ vp: [2, 2] }),
    0,
    12,
    ['the human player', 'Claude'],
  );
  assert.equal(moments[0]?.actorLabel, 'the human player');
  assert.deepEqual(moments[0]?.affectedLabels, ['Claude']);
  assert.equal(moments[0]?.publicSummary, 'the human player moved the robber to hex-3 and targeted Claude.');
  assert.doesNotMatch(moments[0]?.publicSummary ?? '', /^You /);
});
