import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mat4Identity, waterMaterial, type Vec3, type VertexIn, type WaterUniforms } from '../../../engine/index.ts';
import {
  ISLANDERS_WATER_RADIUS,
  ISLANDERS_WATER_RADIUS_X,
  ISLANDERS_WATER_RADIUS_Z,
  ISLANDERS_WATER_SUBDIVISIONS,
  ISLANDERS_WATER_Y,
  islandersWaterMesh,
} from './water.ts';

test('Islanders water is a subdivided finite pointy-top hex aligned with the complete island', () => {
  const mesh = islandersWaterMesh();
  assert.equal(mesh.vertices.length, 1 + 3 * ISLANDERS_WATER_SUBDIVISIONS * (ISLANDERS_WATER_SUBDIVISIONS + 1));
  assert.equal(mesh.indices.length, 18 * ISLANDERS_WATER_SUBDIVISIONS * ISLANDERS_WATER_SUBDIVISIONS);
  assert.ok(mesh.vertices.every((vertex) => vertex.position.y === ISLANDERS_WATER_Y));
  const outerX = Math.max(...mesh.vertices.map((vertex) => Math.abs(vertex.position.x)));
  const outerZ = Math.max(...mesh.vertices.map((vertex) => Math.abs(vertex.position.z)));
  assert.ok(Math.abs(outerX - ISLANDERS_WATER_RADIUS_X * Math.sqrt(3) / 2) < 1e-9);
  assert.ok(Math.abs(outerZ - ISLANDERS_WATER_RADIUS_Z) < 1e-9);
  assert.equal(ISLANDERS_WATER_RADIUS_X, ISLANDERS_WATER_RADIUS);
  assert.equal(ISLANDERS_WATER_RADIUS_Z, ISLANDERS_WATER_RADIUS);
});

test('settled Islanders water omits only the hidden island center', () => {
  const full = islandersWaterMesh();
  const settled = islandersWaterMesh({ omitSettledLand: true });
  assert.equal(settled.vertices.length, full.vertices.length);
  assert.ok(settled.indices.length < full.indices.length * 0.7, 'most center triangles are removed');
  assert.ok(settled.indices.length > full.indices.length * 0.3, 'the visible outer water ring remains');
});

test('water material keeps bright irregular ripples visible across camera angles and time', () => {
  const uniforms: WaterUniforms = {
    mvp: mat4Identity(),
    model: mat4Identity(),
    time: 0,
    cameraPos: { x: 7, y: 8, z: 7 },
    sunDirection: { x: 0.42, y: 0.86, z: 0.5 },
    deepColor: { x: 6, y: 40, z: 66 },
    surfaceColor: { x: 20, y: 119, z: 157 },
    skyColor: { x: 94, y: 152, z: 174 },
    horizonColor: { x: 205, y: 185, z: 146 },
    currentColor: { x: 183, y: 229, z: 225 },
    flowSpeed: 0.38,
  };
  const sample = (point: Vec3): { r: number; g: number; b: number; a: number } => {
    const vertex: VertexIn = { position: point, normal: { x: 0, y: 1, z: 0 }, uv: [0, 0], color: { x: 255, y: 255, z: 255 } };
    const color = waterMaterial.fragment(uniforms, waterMaterial.vertex(uniforms, vertex));
    assert.ok(color);
    return { ...color };
  };

  const atStart = [sample({ x: -3.1, y: ISLANDERS_WATER_Y, z: 1.2 }), sample({ x: 0.7, y: ISLANDERS_WATER_Y, z: -2.4 }), sample({ x: 3.6, y: ISLANDERS_WATER_Y, z: 0.4 })];
  assert.ok(new Set(atStart.map((color) => `${color.r.toFixed(3)}/${color.g.toFixed(3)}/${color.b.toFixed(3)}`)).size > 1);
  assert.ok(atStart.every((color) => color.r < 150 && color.g < 210 && color.b < 220 && color.a === 1));

  // Several samples inside a single tile width should cross different fine ripple crests.
  const nearby = Array.from({ length: 8 }, (_, i) => sample({ x: i * 0.18, y: ISLANDERS_WATER_Y, z: 0.35 }));
  assert.ok(new Set(nearby.map((color) => `${color.r.toFixed(2)}/${color.g.toFixed(2)}/${color.b.toFixed(2)}`)).size >= 5);

  // Shallow opposing views used to lose the reflection and collapse into one dark ASCII glyph.
  // Require both a bright-enough cyan floor and enough range for several glyph buckets in every
  // quadrant, independent of where the narrow specular highlight happens to land.
  for (const cameraPos of [
    { x: 9, y: 4, z: 9 },
    { x: -9, y: 4, z: 9 },
    { x: -9, y: 4, z: -9 },
    { x: 9, y: 4, z: -9 },
  ]) {
    uniforms.cameraPos = cameraPos;
    const angled = Array.from({ length: 25 }, (_, i) => sample({ x: (i % 5) * 1.8 - 3.6, y: ISLANDERS_WATER_Y, z: Math.floor(i / 5) * 1.8 - 3.6 }));
    const luminance = angled.map((color) => color.r * 0.299 + color.g * 0.587 + color.b * 0.114);
    assert.ok(luminance.reduce((sum, value) => sum + value, 0) / luminance.length > 55);
    assert.ok(Math.max(...luminance) - Math.min(...luminance) > 12);
  }

  uniforms.time = 2.75;
  const later = sample({ x: 0.7, y: ISLANDERS_WATER_Y, z: -2.4 });
  assert.notDeepEqual(later, atStart[1]);

  const lifted = waterMaterial.vertex(uniforms, islandersWaterMesh().vertices[700]);
  assert.notEqual(lifted.world.y, ISLANDERS_WATER_Y);
  assert.notDeepEqual(lifted.normal, { x: 0, y: 1, z: 0 });
  uniforms.time = 4.75;
  const moved = waterMaterial.vertex(uniforms, islandersWaterMesh().vertices[700]);
  assert.notEqual(moved.world.y, lifted.world.y);
});
