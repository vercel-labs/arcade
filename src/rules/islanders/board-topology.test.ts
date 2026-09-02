import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  coastalEdgeRing,
  coastalEdges,
  edgeNodes,
  hexEdges,
  hexNodes,
  NUM_EDGES,
  NUM_HEXES,
  NUM_NODES,
  nodeEdges,
  nodeHexes,
  nodeNodes,
} from './board-topology.ts';

test('base board has 19 hexes, 54 nodes, 72 edges (Euler: 54 − 72 + 19 + 1 = 2)', () => {
  assert.equal(NUM_HEXES, 19);
  assert.equal(NUM_NODES, 54);
  assert.equal(NUM_EDGES, 72);
  assert.equal(NUM_NODES - NUM_EDGES + NUM_HEXES + 1, 2);
});

test('every hex has exactly 6 distinct nodes and 6 distinct edges', () => {
  for (let h = 0; h < NUM_HEXES; h++) {
    assert.equal(hexNodes[h].length, 6);
    assert.equal(new Set(hexNodes[h]).size, 6);
    assert.equal(hexEdges[h].length, 6);
    assert.equal(new Set(hexEdges[h]).size, 6);
  }
});

test('every edge has exactly 2 distinct endpoint nodes', () => {
  for (let e = 0; e < NUM_EDGES; e++) {
    const [a, b] = edgeNodes[e];
    assert.notEqual(a, b);
    assert.ok(a >= 0 && a < NUM_NODES && b >= 0 && b < NUM_NODES);
  }
});

test('node→hex incidence: each node touches 1–3 hexes; total incidence = 6·19', () => {
  let total = 0;
  for (let n = 0; n < NUM_NODES; n++) {
    const k = nodeHexes[n].length;
    assert.ok(k >= 1 && k <= 3, `node ${n} touches ${k} hexes`);
    total += k;
  }
  assert.equal(total, 6 * NUM_HEXES);
});

test('node degree (via edges) is 2 or 3, and node↔node adjacency is symmetric', () => {
  for (let n = 0; n < NUM_NODES; n++) {
    const deg = nodeNodes[n].length;
    assert.ok(deg === 2 || deg === 3, `node ${n} has degree ${deg}`);
    for (const m of nodeNodes[n]) assert.ok(nodeNodes[m].includes(n), `asymmetric ${n}↔${m}`);
  }
});

test('edge/node incidence is consistent both ways', () => {
  for (let e = 0; e < NUM_EDGES; e++) {
    for (const n of edgeNodes[e]) assert.ok(nodeEdges[n].includes(e), `edge ${e} missing from node ${n}`);
  }
  for (let n = 0; n < NUM_NODES; n++) {
    for (const e of nodeEdges[n]) assert.ok(edgeNodes[e].includes(n), `node ${n} not an endpoint of edge ${e}`);
  }
});

test('there are 30 coastal edges forming one perimeter ring', () => {
  assert.equal(coastalEdges.length, 30);
  // The ring walk visited every coastal edge exactly once (a single closed loop), which also
  // proves every coastal node has exactly two coastal edges.
  assert.equal(coastalEdgeRing.length, coastalEdges.length);
  assert.deepEqual(new Set(coastalEdgeRing), new Set(coastalEdges));
});
