import { edgeNodes, nodeEdges } from '../../../rules/catan/board-topology.ts';
import type { CatanState } from '../../../rules/catan/catan.ts';
import type { CatanAction } from '../../../rules/catan/types.ts';
import type { GameMoment } from '../../communication/moments.ts';

export function detectCatanMoments(
  before: CatanState,
  action: CatanAction,
  after: CatanState,
  actorSeat: number,
  actionNumber: number,
  labels: readonly string[],
): GameMoment[] {
  const moments: GameMoment[] = [];
  const label = (seat: number): string => labels[seat] ?? `P${seat + 1}`;
  const make = (moment: Omit<GameMoment, 'id' | 'game' | 'actorSeat'>): void => {
    moments.push({ id: `catan-${actionNumber}-${moments.length + 1}`, game: 'catan', actorSeat, ...moment });
  };

  const beforeVp = Array.from({ length: after.n }, (_, seat) => before.victoryPoints(seat, false));
  const afterVp = Array.from({ length: after.n }, (_, seat) => after.victoryPoints(seat, false));
  if (afterVp[actorSeat] >= 8 && afterVp[actorSeat] > beforeVp[actorSeat]) {
    make({
      type: afterVp[actorSeat] >= 9 ? 'imminent_win' : 'leader_pressure',
      affectedSeats: Array.from({ length: after.n }, (_, seat) => seat).filter((seat) => seat !== actorSeat),
      relevantSeats: Array.from({ length: after.n }, (_, seat) => seat).filter((seat) => seat !== actorSeat),
      strength: afterVp[actorSeat] >= 9 ? 'dramatic' : 'notable',
      importance: afterVp[actorSeat] >= 9 ? 0.98 : 0.86,
      publicSummary: `${label(actorSeat)} reached ${afterVp[actorSeat]} visible victory points.`,
      publicFacts: [`${label(actorSeat)} is now on ${afterVp[actorSeat]} public VP.`],
      suggestedIntents: ['table_politics', 'react'],
      responseExpectation: 'encouraged',
      beatKey: `leader-pressure:${actorSeat}`,
    });
  }

  for (const [type, prior, next] of [
    ['longest_road_changed', before.longestRoad(), after.longestRoad()],
    ['largest_army_changed', before.largestArmy(), after.largestArmy()],
  ] as const) {
    if (prior === next || next < 0) continue;
    make({
      type,
      affectedSeats: prior >= 0 ? [prior] : [],
      relevantSeats: Array.from({ length: after.n }, (_, seat) => seat).filter((seat) => seat !== next),
      strength: 'dramatic',
      importance: 0.94,
      publicSummary: `${label(next)} took ${type === 'longest_road_changed' ? 'Longest Road' : 'Largest Army'}${prior >= 0 ? ` from ${label(prior)}` : ''}.`,
      publicFacts: [],
      suggestedIntents: ['react', 'table_politics', 'banter'],
      responseExpectation: 'encouraged',
      beatKey: type,
    });
  }

  if (action.type === 'buildRoad') {
    const affected = new Set<number>();
    for (const node of edgeNodes[action.edge]) {
      for (const edge of nodeEdges[node]) {
        const owner = before.roadAt(edge);
        if (owner !== undefined && owner !== actorSeat) affected.add(owner);
      }
    }
    if (affected.size) make({
      type: 'contested_route',
      affectedSeats: [...affected],
      relevantSeats: [...affected],
      strength: 'notable',
      importance: 0.82,
      publicSummary: `${label(actorSeat)} built into a route contested by ${[...affected].map(label).join(' and ')}.`,
      publicFacts: [`The new road connects ${edgeNodes[action.edge].map((node) => after.publicNodeLabel(node)).join(' toward ')}.`],
      suggestedIntents: ['react', 'banter', 'table_politics'],
      responseExpectation: 'encouraged',
      beatKey: `route-conflict:${[...edgeNodes[action.edge]].sort().join('-')}`,
    });
  }

  if (action.type === 'buildSettlement') {
    const affected = new Set<number>();
    for (const edge of nodeEdges[action.node]) {
      const owner = before.roadAt(edge);
      if (owner !== undefined && owner !== actorSeat) affected.add(owner);
    }
    if (affected.size) make({
      type: 'contested_settlement', affectedSeats: [...affected], relevantSeats: [...affected],
      strength: 'dramatic', importance: 0.9,
      publicSummary: `${label(actorSeat)} claimed ${after.publicNodeLabel(action.node)} beside ${[...affected].map(label).join(' and ')}'s route.`,
      publicFacts: [], suggestedIntents: ['react', 'banter', 'table_politics'], responseExpectation: 'encouraged',
      beatKey: `settlement-conflict:${action.node}`,
    });
  }

  if ((action.type === 'moveRobber' || action.type === 'playKnight') && action.victim !== null) {
    const leader = afterVp.indexOf(Math.max(...afterVp));
    make({
      type: action.victim === leader ? 'robber_targets_leader' : 'robber_attack',
      affectedSeats: [action.victim], relevantSeats: [action.victim, leader].filter((seat) => seat !== actorSeat),
      strength: action.victim === leader ? 'notable' : 'routine', importance: action.victim === leader ? 0.84 : 0.68,
      publicSummary: `${label(actorSeat)} moved the robber to ${after.publicHexLabel(action.hex)} and targeted ${label(action.victim)}.`,
      publicFacts: action.victim === leader ? [`${label(action.victim)} has the highest visible score.`] : [],
      suggestedIntents: ['react', 'table_politics', 'banter'], responseExpectation: 'encouraged',
      beatKey: `robber:${actorSeat}:${action.victim}`,
    });
  }

  return moments;
}
