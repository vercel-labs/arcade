import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coastalEdges, edgeNodes, HEX_COORDS, hexNodes, NUM_NODES } from './board-topology.ts';
import { generateBoard, nodeProduction } from './setup.ts';
import { NUMBER_TOKENS, RED_NUMBERS, TERRAIN_COUNTS, TERRAIN_RESOURCE, type Terrain, TOKEN_DOTS } from './types.ts';

// Deterministic RNG (mulberry32) so boards are reproducible.
function rng(seed = 0xc0ffee): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// Hex adjacency from axial coords (independent of setup.ts internals), for the 6/8 test.
const DIRS = [
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
  return HEX_COORDS.map((c) =>
    DIRS.map(([dq, dr]) => at.get(`${c.q + dq},${c.r + dr}`)).filter((x): x is number => x !== undefined),
  );
}

test('terrain multiset matches the base game (4/4/4/3/3/1)', () => {
  const board = generateBoard(rng());
  assert.equal(board.hexes.length, 19);
  const counts = {} as Record<Terrain, number>;
  for (const h of board.hexes) counts[h.terrain] = (counts[h.terrain] ?? 0) + 1;
  assert.deepEqual(counts, TERRAIN_COUNTS);
});

test('number tokens: 18 on non-desert hexes, none on the desert, multiset matches', () => {
  const board = generateBoard(rng());
  const tokens: number[] = [];
  for (const h of board.hexes) {
    if (h.terrain === 'desert') assert.equal(h.token, null);
    else {
      assert.notEqual(h.token, null);
      tokens.push(h.token as number);
    }
  }
  assert.equal(tokens.length, 18);
  assert.deepEqual(tokens.slice().sort((a, b) => a - b), [...NUMBER_TOKENS].sort((a, b) => a - b));
});

test('robber starts on the desert', () => {
  const board = generateBoard(rng());
  assert.equal(board.hexes[board.robberHex].terrain, 'desert');
});

test('no two red numbers (6/8) are on adjacent hexes', () => {
  const nbrs = hexNeighbors();
  // Check several seeds.
  for (const seed of [1, 2, 3, 42, 1000, 0xbeef]) {
    const board = generateBoard(rng(seed));
    for (let h = 0; h < board.hexes.length; h++) {
      const t = board.hexes[h].token;
      if (t === null || !RED_NUMBERS.includes(t)) continue;
      for (const nb of nbrs[h]) {
        const tn = board.hexes[nb].token;
        assert.ok(tn === null || !RED_NUMBERS.includes(tn), `red ${t}@${h} adjacent to red ${tn}@${nb} (seed ${seed})`);
      }
    }
  }
});

test('9 harbors on distinct coastal edges, each mapped to its two coastal nodes', () => {
  const board = generateBoard(rng());
  assert.equal(board.harbors.length, 9);
  const coastal = new Set(coastalEdges);
  const seen = new Set<number>();
  let generic = 0;
  let specific = 0;
  for (const h of board.harbors) {
    assert.ok(coastal.has(h.edge), `harbor edge ${h.edge} is not coastal`);
    assert.ok(!seen.has(h.edge), `duplicate harbor edge ${h.edge}`);
    seen.add(h.edge);
    assert.deepEqual([...h.nodes].sort((a, b) => a - b), [...edgeNodes[h.edge]].sort((a, b) => a - b));
    if (h.port.resource === null) generic++;
    else specific++;
  }
  assert.equal(generic, 4);
  assert.equal(specific, 5);
});

test('same seed → identical board (deterministic)', () => {
  assert.deepEqual(generateBoard(rng(777)), generateBoard(rng(777)));
});

test('nodeProduction: total dots = Σ over producing hexes of dots·6', () => {
  const board = generateBoard(rng());
  const prod = nodeProduction(board);
  assert.equal(prod.length, NUM_NODES);
  let nodeTotal = 0;
  for (const p of prod) for (const v of Object.values(p)) nodeTotal += v as number;
  let hexTotal = 0;
  for (let h = 0; h < board.hexes.length; h++) {
    const { terrain, token } = board.hexes[h];
    if (TERRAIN_RESOURCE[terrain] === null || token === null) continue;
    hexTotal += (TOKEN_DOTS[token] ?? 0) * hexNodes[h].length;
  }
  assert.equal(nodeTotal, hexTotal);
});
