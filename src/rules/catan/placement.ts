// Board placement invariants for Catan — the pure spatial predicates that decide where a
// piece may legally go, given who owns what. No rendering, no resource/turn logic (that lives
// in catan.ts); this is the shared rule core the board editor uses now and the eventual
// legalActions()/applyAction() will build on. Generic over the owner identity — a seat index
// in the engine, a PlayerColor in the editor — so one implementation serves both. See
// docs/catan.md §3.4.

import { edgeNodes, nodeEdges, nodeNodes } from './board-topology.ts';

// A read-only view of the board's occupancy. Callers adapt their own storage (a Map, the
// engine's arrays) to these two lookups; `undefined` means the spot is empty.
export interface BoardOccupancy<Owner> {
  building(node: number): { owner: Owner; city: boolean } | undefined;
  road(edge: number): Owner | undefined;
}

// Distance rule: a settlement needs an empty vertex whose every adjacent vertex is also empty —
// no two buildings, of any color, on neighboring nodes.
export function canPlaceSettlement<O>(node: number, occ: BoardOccupancy<O>): boolean {
  if (occ.building(node)) return false;
  for (const adj of nodeNodes[node]) if (occ.building(adj)) return false;
  return true;
}

// A city only replaces its owner's own existing settlement (never an opponent's, never bare
// ground).
export function canUpgradeCity<O>(node: number, owner: O, occ: BoardOccupancy<O>): boolean {
  const b = occ.building(node);
  return b !== undefined && !b.city && b.owner === owner;
}

// Road connectivity: an empty edge is placeable iff one of its endpoints links it into the
// owner's network — the owner's own building sits there, or the owner has another road meeting
// there — and that endpoint isn't blocked by an enemy building (a road can't route through an
// opponent's settlement/city).
export function canPlaceRoad<O>(edge: number, owner: O, occ: BoardOccupancy<O>): boolean {
  if (occ.road(edge) !== undefined) return false;
  const [a, b] = edgeNodes[edge];
  return connectsAt(a, edge, owner, occ) || connectsAt(b, edge, owner, occ);
}

// Whether a road on `viaEdge` connects to `owner`'s network through endpoint `node`: the
// owner's own building there always connects; an enemy building blocks the route entirely;
// otherwise the node must carry another of the owner's roads.
function connectsAt<O>(node: number, viaEdge: number, owner: O, occ: BoardOccupancy<O>): boolean {
  const b = occ.building(node);
  if (b) return b.owner === owner;
  for (const e of nodeEdges[node]) if (e !== viaEdge && occ.road(e) === owner) return true;
  return false;
}
