// Board setup: assign terrain, number tokens, and harbors onto the static topology
// (board-topology.ts). Pure and seeded — pass an RNG for reproducible boards (tests,
// snapshots); defaults to Math.random. This is the current rulebook's "variable setup":
// terrain is shuffled, then the A–R number sequence spirals counterclockwise from a corner
// toward the center, skipping the desert. It is not the fixed beginner layout.

import {
  coastalEdgeRing,
  edgeNodes,
  HEX_COORDS,
  hexNodes,
  NUM_HEXES,
  NUM_NODES,
} from './board-topology.ts';
import {
  NUMBER_TOKENS,
  OFFICIAL_NUMBER_SEQUENCE,
  type Port,
  PORTS,
  type Resource,
  TERRAIN_COUNTS,
  TERRAIN_RESOURCE,
  type Terrain,
  TERRAINS,
  TOKEN_DOTS,
} from './types.ts';

export interface HexSetup {
  terrain: Terrain;
  token: number | null; // null on the desert (no token)
}

export interface HarborSetup {
  port: Port;
  edge: number; // coastal edge the harbor sits on
  nodes: [number, number]; // the two coastal intersections that can use it
}

export interface BoardSetup {
  hexes: HexSetup[]; // indexed by hex id 0..18
  robberHex: number; // the desert hex, where the robber starts
  harbors: HarborSetup[]; // 9
}

// In-place Fisher–Yates with an injected RNG (0..1), so callers own the seed.
function shuffle<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// The terrain multiset (19 tiles) in a fixed order, expanded from TERRAIN_COUNTS.
function terrainBag(): Terrain[] {
  const bag: Terrain[] = [];
  for (const t of TERRAINS) for (let i = 0; i < TERRAIN_COUNTS[t]; i++) bag.push(t);
  return bag;
}

// Starting at the southwest corner, walk each ring counterclockwise, then move inward. The
// rulebook permits any starting corner; fixing one removes a meaningless rotational random
// choice while terrain remains shuffled. In flat-top world space this direction order moves
// counterclockwise from southwest through south, southeast, northeast, north, and northwest.
const COUNTERCLOCKWISE_RING_DIRS: readonly [number, number][] = [
  [1, -1],
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [0, -1],
];

function officialHexSpiral(): number[] {
  const at = new Map(HEX_COORDS.map((coord, id) => [`${coord.q},${coord.r}`, id]));
  const order: number[] = [];
  for (let radius = 2; radius >= 1; radius--) {
    let q = -radius;
    let r = 0;
    for (const [dq, dr] of COUNTERCLOCKWISE_RING_DIRS) {
      for (let step = 0; step < radius; step++) {
        const id = at.get(`${q},${r}`);
        if (id === undefined) throw new Error(`Missing Catan hex at ${q},${r}`);
        order.push(id);
        q += dq;
        r += dr;
      }
    }
  }
  const center = at.get('0,0');
  if (center === undefined) throw new Error('Missing center Catan hex');
  order.push(center);
  return order;
}
const OFFICIAL_HEX_SPIRAL = officialHexSpiral();

// Place discs A through R along the official spiral and skip the desert without consuming a
// disc. This fixed spatial sequence is what keeps the production numbers broadly balanced.
function placeTokens(hexes: HexSetup[]): void {
  let tokenIndex = 0;
  for (const hex of OFFICIAL_HEX_SPIRAL) {
    if (hexes[hex].terrain === 'desert') continue;
    hexes[hex].token = OFFICIAL_NUMBER_SEQUENCE[tokenIndex++];
  }
  if (tokenIndex !== NUMBER_TOKENS.length) throw new Error(`Placed ${tokenIndex} Catan number tokens`);
}

// The physical sea frame has 9 marked harbor slots. Around its 30 coastal edges those slots
// repeat a 3/3/4 spacing: each port touches one full coastal edge and therefore has exactly
// two usable land intersections. Variable setup shuffles the 9 harbor pieces among these
// frame slots; it does not choose arbitrary adjacent coastline edges.
const HARBOR_EDGE_GAPS = [3, 3, 4, 3, 3, 4, 3, 3, 4] as const;
function placeHarbors(rng: () => number): HarborSetup[] {
  const ring = coastalEdgeRing;
  const ports = shuffle([...PORTS], rng);
  let ringIndex = 0;
  return ports.map((port, i) => {
    const edge = ring[ringIndex];
    const [a, b] = edgeNodes[edge];
    ringIndex = (ringIndex + HARBOR_EDGE_GAPS[i]) % ring.length;
    return { port, edge, nodes: [a, b] as [number, number] };
  });
}

export function generateBoard(rng: () => number = Math.random): BoardSetup {
  const bag = shuffle(terrainBag(), rng);
  const hexes: HexSetup[] = bag.map((terrain) => ({ terrain, token: null }));
  placeTokens(hexes);
  const robberHex = hexes.findIndex((h) => h.terrain === 'desert');
  const harbors = placeHarbors(rng);
  return { hexes, robberHex, harbors };
}

// Expected per-roll yield of a settlement on each node: for every adjacent producing hex,
// the resource it makes weighted by the token's dots (out of 36). The core input to a
// heuristic AI value function (docs/catan.md §3.7); pure over a BoardSetup.
export function nodeProduction(board: BoardSetup): Partial<Record<Resource, number>>[] {
  const out: Partial<Record<Resource, number>>[] = Array.from({ length: NUM_NODES }, () => ({}));
  for (let h = 0; h < NUM_HEXES; h++) {
    const { terrain, token } = board.hexes[h];
    const resource = TERRAIN_RESOURCE[terrain];
    if (resource === null || token === null) continue;
    const dots = TOKEN_DOTS[token] ?? 0;
    for (const n of hexNodes[h]) out[n][resource] = (out[n][resource] ?? 0) + dots;
  }
  return out;
}
