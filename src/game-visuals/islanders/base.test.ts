import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from './build.ts';
import { EDGE_Y, R_RIM, terrainPerimeterSkirt } from './base.ts';

test('raised hex terrain receives a lightweight sealed perimeter skirt', () => {
  const mesh = build();
  terrainPerimeterSkirt(mesh, (x, z) => EDGE_Y + 0.18 * (1 - Math.abs(x + z) * 0.05), [180, 120, 70], 3);
  assert.equal(mesh.indices.length, 6 * 3 * 6, 'one two-triangle quad per side segment');
  const apothem = R_RIM * Math.cos(Math.PI / 6);
  const sealedSides = new Set<number>();
  for (const vertex of mesh.vertices) {
    if (Math.abs(vertex.position.y - EDGE_Y) > 1e-6) continue;
    for (let side = 0; side < 6; side++) {
      const angle = Math.PI / 6 + side * Math.PI / 3;
      const projection = vertex.position.x * Math.cos(angle) + vertex.position.z * Math.sin(angle);
      if (Math.abs(projection - apothem) < 1e-6) sealedSides.add(side);
    }
  }
  assert.equal(sealedSides.size, 6, 'every hex side reaches the shared rim elevation');
  assert.ok(mesh.vertices.some((vertex) => vertex.position.y > EDGE_Y + 0.1), 'skirt retains the raised terrain silhouette');
});
