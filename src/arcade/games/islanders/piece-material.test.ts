import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mat4Identity, normalize3, type Vec3 } from '../../../engine/index.ts';
import { islandersPieceMaterial } from '../../../game-visuals/islanders/piece-material.ts';

const lightDir = normalize3({ x: 0.5, y: 0.72, z: 0.48 });
const uniforms = {
  mvp: mat4Identity(),
  model: mat4Identity(),
  lightDir,
  ambient: 0.62,
  wrap: 1,
};

function shade(color: Vec3, normal: Vec3): { r: number; g: number; b: number; a: number } {
  const vertex = {
    position: { x: 0, y: 0, z: 0 },
    normal,
    uv: [0, 0] as [number, number],
    color,
  };
  return { ...islandersPieceMaterial.fragment(uniforms, islandersPieceMaterial.vertex(uniforms, vertex))! };
}

function luminance(color: { r: number; g: number; b: number }): number {
  return color.r * 0.299 + color.g * 0.587 + color.b * 0.114;
}

test('white Islanders pieces keep bright key faces and materially darker ASCII shadows', () => {
  const ivory = { x: 252, y: 249, z: 238 };
  const lit = shade(ivory, lightDir);
  const shadow = shade(ivory, { x: -lightDir.x, y: -lightDir.y, z: -lightDir.z });
  assert.ok(luminance(lit) > 240);
  assert.ok(luminance(shadow) > 85 && luminance(shadow) < 115);
  assert.ok(luminance(lit) - luminance(shadow) > 130);
});

test('differently oriented shadow faces retain distinct ASCII brightness buckets', () => {
  const ivory = { x: 252, y: 249, z: 238 };
  const shadowX = luminance(shade(ivory, { x: -1, y: 0, z: 0 }));
  const shadowZ = luminance(shade(ivory, { x: 0, y: 0, z: -1 }));
  assert.ok(Math.abs(shadowX - shadowZ) > 15);
  assert.ok(shadowX > 80 && shadowX < 120);
  assert.ok(shadowZ > 80 && shadowZ < 120);
});

test('red and blue shadow faces occupy distinct ASCII luminance buckets', () => {
  for (const color of [
    { x: 201, y: 58, z: 47 },
    { x: 56, y: 106, z: 200 },
  ]) {
    const shadowX = luminance(shade(color, { x: -1, y: 0, z: 0 }));
    const shadowZ = luminance(shade(color, { x: 0, y: 0, z: -1 }));
    assert.ok(Math.abs(shadowX - shadowZ) > 18);
    assert.ok(Math.min(shadowX, shadowZ) > 45);
  }
});

test('orange retains its existing moderate shadow separation', () => {
  const orange = { x: 227, y: 129, z: 42 };
  const shadowX = luminance(shade(orange, { x: -1, y: 0, z: 0 }));
  const shadowZ = luminance(shade(orange, { x: 0, y: 0, z: -1 }));
  assert.ok(Math.abs(shadowX - shadowZ) > 12 && Math.abs(shadowX - shadowZ) < 18);
});
