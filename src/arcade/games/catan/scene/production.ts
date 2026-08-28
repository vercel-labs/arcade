// Who collects what on a dice roll.
//
// The test bed keeps its own board and building map instead of a live CatanState, so this
// mirrors the engine's private distributeProduction (rules/catan/catan.ts) over those structures
// and by the same rules: a hex pays out only when its token matches the roll, the hex under the
// robber pays nothing (`robberHex` moves, so it is passed in rather than read off the layout), the desert has no resource, and a city draws two where a settlement draws one.
// Adjacency is the real topology, so a corner collects from every hex it touches.
//
// Unlike the engine there is no bank here to run dry, and no other seat to compete for a short
// supply — the sandbox pays the one color it is asked about.

import { hexNodes, NUM_HEXES } from '../../../../rules/catan/board-topology.ts';
import { type BoardSetup } from '../../../../rules/catan/setup.ts';
import { type PlayerColor, type Resource, TERRAIN_RESOURCE } from '../../../../rules/catan/types.ts';

export type BoardBuildings = ReadonlyMap<number, { city: boolean; color: PlayerColor }>;

// Kept per hex rather than summed straight into a total: the HUD flies each card out of the tile
// that paid it, so it needs to know which hex owes what before the totals are merged.
export interface HexPayout {
  hex: number;
  resource: Resource;
  count: number;
}

export function rollPayouts(board: BoardSetup, buildings: BoardBuildings, color: PlayerColor, roll: number, robberHex: number): HexPayout[] {
  const out: HexPayout[] = [];
  for (let hex = 0; hex < NUM_HEXES; hex++) {
    if (hex === robberHex || board.hexes[hex].token !== roll) continue;
    const resource = TERRAIN_RESOURCE[board.hexes[hex].terrain];
    if (resource === null) continue;
    let count = 0;
    for (const node of hexNodes[hex]) {
      const building = buildings.get(node);
      if (building?.color !== color) continue;
      count += building.city ? 2 : 1;
    }
    if (count) out.push({ hex, resource, count });
  }
  return out;
}

export function rollYield(board: BoardSetup, buildings: BoardBuildings, color: PlayerColor, roll: number, robberHex: number): Partial<Record<Resource, number>> {
  const gained: Partial<Record<Resource, number>> = {};
  for (const payout of rollPayouts(board, buildings, color, roll, robberHex)) {
    gained[payout.resource] = (gained[payout.resource] ?? 0) + payout.count;
  }
  return gained;
}
