// Board setup: assign terrain, number tokens, and harbors onto the static topology
// (board-topology.ts). Pure and seeded — pass an RNG for reproducible boards (tests,
// snapshots); defaults to Math.random. This is the "variable setup" of the rulebook, not
// the fixed beginner layout. See docs/catan.md §2, §3.4.

import {
  coastalEdgeRing,
  edgeNodes,
  HEX_COORDS,
  type HexCoord,
  hexNodes,
  NUM_HEXES,
  NUM_NODES,
} from './board-topology.ts';
import {
  NUMBER_TOKENS,
  type Port,
  PORTS,
  RED_NUMBERS,
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

// Which hexes share an edge (are adjacent), derived from axial coords. Used to enforce the
// red-number (6/8) adjacency rule.
const DIRS: readonly [number, number][] = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];
function hexNeighbors(): number[][] {
  const at = new Map<string, number>();
  HEX_COORDS.forEach((c, i) => at.set(`${c.q},${c.r}`, i));
  return HEX_COORDS.map((c: HexCoord) => {
    const nbrs: number[] = [];
    for (const [dq, dr] of DIRS) {
      const id = at.get(`${c.q + dq},${c.r + dr}`);
      if (id !== undefined) nbrs.push(id);
    }
    return nbrs;
  });
}
const HEX_NEIGHBORS = hexNeighbors();

// The terrain multiset (19 tiles) in a fixed order, expanded from TERRAIN_COUNTS.
function terrainBag(): Terrain[] {
  const bag: Terrain[] = [];
  for (const t of TERRAINS) for (let i = 0; i < TERRAIN_COUNTS[t]; i++) bag.push(t);
  return bag;
}

// True if any two red-number (6/8) tokens sit on adjacent hexes.
function hasAdjacentRedNumbers(hexes: HexSetup[]): boolean {
  for (let h = 0; h < hexes.length; h++) {
    if (hexes[h].token === null || !RED_NUMBERS.includes(hexes[h].token as number)) continue;
    for (const nb of HEX_NEIGHBORS[h]) {
      if (hexes[nb].token !== null && RED_NUMBERS.includes(hexes[nb].token as number)) return true;
    }
  }
  return false;
}

// Assign the 18 tokens to the 18 non-desert hexes, reshuffling until the 6/8-not-adjacent
// rule holds. With only four red tokens among 18 hexes a valid arrangement is found almost
// immediately; the attempt cap is a safety net (deterministic under a fixed seed).
function placeTokens(hexes: HexSetup[], rng: () => number): void {
  const landHexes = hexes.map((h, i) => i).filter((i) => hexes[i].terrain !== 'desert');
  for (let attempt = 0; attempt < 10000; attempt++) {
    const tokens = shuffle([...NUMBER_TOKENS], rng);
    landHexes.forEach((h, i) => {
      hexes[h].token = tokens[i];
    });
    if (!hasAdjacentRedNumbers(hexes)) return;
  }
  // Extremely unlikely to reach here; leave the last arrangement (still a legal board apart
  // from the aesthetic red-adjacency preference) rather than loop forever.
}

// Place the 9 harbors on coastal edges, spread evenly around the perimeter ring. Which port
// lands where is randomized. NOTE: this is a structurally-valid placement (9 distinct
// coastal edges, each mapped to its two usable intersections) — not the exact fixed-frame
// arrangement of the physical board, which is a later (beginner-layout) refinement.
function placeHarbors(rng: () => number): HarborSetup[] {
  const ring = coastalEdgeRing;
  const ports = shuffle([...PORTS], rng);
  const step = ring.length / ports.length;
  return ports.map((port, i) => {
    const edge = ring[Math.floor(i * step) % ring.length];
    const [a, b] = edgeNodes[edge];
    return { port, edge, nodes: [a, b] as [number, number] };
  });
}

export function generateBoard(rng: () => number = Math.random): BoardSetup {
  const bag = shuffle(terrainBag(), rng);
  const hexes: HexSetup[] = bag.map((terrain) => ({ terrain, token: null }));
  placeTokens(hexes, rng);
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
