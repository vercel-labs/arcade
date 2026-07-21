// The static board graph for the base 19-hex Catan board: which vertices (settlement/city
// spots) and edges (road spots) exist and how they connect. Computed ONCE at module load
// into frozen integer-indexed tables; the runtime engine only does O(1) lookups.
//
// The one hard problem is that vertices and edges are SHARED between hexes — the same
// corner is touched by up to 3 hexes, the same edge by 2 — so they must be single
// canonical objects, not per-hex duplicates, or adjacency (and longest-road breaks) go
// wrong. We solve it with exact-integer geometry, no floats:
//
//   • Every VERTEX is the meeting of a triple of hex positions (this hex + two angularly
//     adjacent neighbors, some possibly off-board). Its identity is that unordered triple.
//   • Every EDGE is a pair of hex positions (this hex + one neighbor). Its identity is that
//     unordered pair.
//
// Interning those sorted keys yields exactly 54 vertices and 72 edges for the 19-hex board
// (Euler: 54 − 72 + 19 + 1 = 2). This is the integer-ID version of catanatron's
// construction-time dedup — no hand-listed adjacency arrays. See docs/catan.md §3.3.

export interface HexCoord {
  q: number;
  r: number;
}

// Axial neighbor directions in rotational (ring) order. Consecutive directions bound a
// shared corner; each direction is one shared edge. Orientation (pointy/flat top) is a
// rendering choice and doesn't affect topology.
const DIRS: readonly [number, number][] = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

// The 19 hexes: every axial coord within cube-distance 2 of the center (a radius-2
// hexagon: 1 + 6 + 12). Row-major generation → a stable, deterministic hex ordering 0..18.
function hexCoords(): HexCoord[] {
  const out: HexCoord[] = [];
  for (let q = -2; q <= 2; q++) {
    for (let r = -2; r <= 2; r++) {
      if (Math.abs(q) <= 2 && Math.abs(r) <= 2 && Math.abs(q + r) <= 2) out.push({ q, r });
    }
  }
  return out;
}

const key = (c: HexCoord): string => `${c.q},${c.r}`;
const add = (c: HexCoord, d: readonly [number, number]): HexCoord => ({ q: c.q + d[0], r: c.r + d[1] });
// A canonical key for a set of hex coords (a corner-triple or edge-pair): sort, then join.
const setKey = (coords: HexCoord[]): string =>
  coords
    .map(key)
    .sort()
    .join('|');

interface Topology {
  hexCoords: HexCoord[];
  hexNodes: number[][]; // [hex][0..5] → node id (corner k is between DIRS[k] and DIRS[k+1])
  hexEdges: number[][]; // [hex][0..5] → edge id (edge k crosses DIRS[k])
  edgeNodes: [number, number][]; // [edge] → its 2 endpoint node ids
  nodeHexes: number[][]; // [node] → the on-board hexes touching it (1..3)
  nodeNodes: number[][]; // [node] → adjacent node ids (via an edge)
  nodeEdges: number[][]; // [node] → incident edge ids
  edgeEdges: number[][]; // [edge] → edges sharing an endpoint
  coastalNodes: number[]; // nodes touching < 3 hexes
  coastalEdges: number[]; // edges bordering only 1 on-board hex (the sea)
  coastalEdgeRing: number[]; // coastal edges in perimeter order (for harbor placement)
}

function build(): Topology {
  const coords = hexCoords();

  const nodeIds = new Map<string, number>();
  const edgeIds = new Map<string, number>();
  const intern = (map: Map<string, number>, k: string): number => {
    let id = map.get(k);
    if (id === undefined) {
      id = map.size;
      map.set(k, id);
    }
    return id;
  };

  const hexNodes: number[][] = [];
  const hexEdges: number[][] = [];
  const edgeNodes: [number, number][] = [];
  const edgeHexCount: number[] = []; // how many on-board hexes generated each edge

  // Pass 1: intern every corner and edge, recording per-hex corner/edge ids and each
  // edge's two endpoint corners.
  for (const h of coords) {
    const corners: number[] = [];
    for (let k = 0; k < 6; k++) {
      corners.push(intern(nodeIds, setKey([h, add(h, DIRS[k]), add(h, DIRS[(k + 1) % 6])])));
    }
    hexNodes.push(corners);

    const edges: number[] = [];
    for (let k = 0; k < 6; k++) {
      const eKey = setKey([h, add(h, DIRS[k])]);
      const firstTime = !edgeIds.has(eKey);
      const eId = intern(edgeIds, eKey);
      edges.push(eId);
      // Edge k (across DIRS[k]) is bounded by corner k-1 and corner k.
      const ends: [number, number] = [corners[(k + 5) % 6], corners[k]];
      if (firstTime) {
        edgeNodes[eId] = ends;
        edgeHexCount[eId] = 1;
      } else {
        edgeHexCount[eId]++;
      }
    }
    hexEdges.push(edges);
  }

  const numNodes = nodeIds.size;
  const numEdges = edgeIds.size;

  // Pass 2: invert to node→hex, and derive node/edge adjacency from edgeNodes.
  const nodeHexes: number[][] = Array.from({ length: numNodes }, () => []);
  for (let h = 0; h < coords.length; h++) {
    for (const n of hexNodes[h]) nodeHexes[n].push(h);
  }

  const nodeEdges: number[][] = Array.from({ length: numNodes }, () => []);
  for (let e = 0; e < numEdges; e++) {
    for (const n of edgeNodes[e]) nodeEdges[n].push(e);
  }
  const nodeNodes: number[][] = Array.from({ length: numNodes }, () => []);
  for (let e = 0; e < numEdges; e++) {
    const [a, b] = edgeNodes[e];
    nodeNodes[a].push(b);
    nodeNodes[b].push(a);
  }
  const edgeEdges: number[][] = Array.from({ length: numEdges }, () => []);
  for (let e = 0; e < numEdges; e++) {
    for (const n of edgeNodes[e]) {
      for (const other of nodeEdges[n]) if (other !== e && !edgeEdges[e].includes(other)) edgeEdges[e].push(other);
    }
  }

  // Coastal = on the island's boundary. A node touching < 3 hexes and an edge bordering
  // only one on-board hex sit on the sea frame; harbors live on coastal edges.
  const coastalNodes: number[] = [];
  for (let n = 0; n < numNodes; n++) if (nodeHexes[n].length < 3) coastalNodes.push(n);
  const coastalEdges: number[] = [];
  for (let e = 0; e < numEdges; e++) if (edgeHexCount[e] === 1) coastalEdges.push(e);

  return {
    hexCoords: coords,
    hexNodes,
    hexEdges,
    edgeNodes,
    nodeHexes,
    nodeNodes,
    nodeEdges,
    edgeEdges,
    coastalNodes,
    coastalEdges,
    coastalEdgeRing: coastalRing(coastalEdges, edgeNodes),
  };
}

// Walk the coastal edges into a single perimeter cycle. On a solid hex island the boundary
// is one loop and every coastal node has exactly two coastal edges, so we can follow it
// edge → shared node → next edge until we return to the start.
function coastalRing(coastalEdges: number[], edgeNodes: [number, number][]): number[] {
  if (coastalEdges.length === 0) return [];
  const perNode = new Map<number, number[]>();
  for (const e of coastalEdges) {
    for (const n of edgeNodes[e]) {
      const arr = perNode.get(n) ?? [];
      arr.push(e);
      perNode.set(n, arr);
    }
  }
  const ring: number[] = [];
  const start = coastalEdges[0];
  let prevNode = edgeNodes[start][0];
  let cur = start;
  do {
    ring.push(cur);
    const [a, b] = edgeNodes[cur];
    const nextNode = a === prevNode ? b : a;
    const opts = perNode.get(nextNode);
    if (!opts || opts.length !== 2) break; // not a clean loop — bail (topology test catches this)
    cur = opts[0] === cur ? opts[1] : opts[0];
    prevNode = nextNode;
  } while (cur !== start && ring.length <= coastalEdges.length);
  return ring;
}

const TOPO = build();

export const HEX_COORDS: readonly HexCoord[] = TOPO.hexCoords;
export const NUM_HEXES = TOPO.hexCoords.length;
export const NUM_NODES = TOPO.nodeHexes.length;
export const NUM_EDGES = TOPO.edgeNodes.length;

export const hexNodes: readonly (readonly number[])[] = TOPO.hexNodes;
export const hexEdges: readonly (readonly number[])[] = TOPO.hexEdges;
export const edgeNodes: readonly (readonly [number, number])[] = TOPO.edgeNodes;
export const nodeHexes: readonly (readonly number[])[] = TOPO.nodeHexes;
export const nodeNodes: readonly (readonly number[])[] = TOPO.nodeNodes;
export const nodeEdges: readonly (readonly number[])[] = TOPO.nodeEdges;
export const edgeEdges: readonly (readonly number[])[] = TOPO.edgeEdges;
export const coastalNodes: readonly number[] = TOPO.coastalNodes;
export const coastalEdges: readonly number[] = TOPO.coastalEdges;
export const coastalEdgeRing: readonly number[] = TOPO.coastalEdgeRing;
