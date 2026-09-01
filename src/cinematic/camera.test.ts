import assert from 'node:assert/strict';
import test from 'node:test';
import { cameraMatrices } from '../engine/camera.ts';
import { mat4MulVec4 } from '../engine/math.ts';
import { pokerSeatAngle } from '../game-visuals/poker/layout.ts';
import { pokerCinematicCamera } from './camera.ts';

// Conservative production-table envelope: outer chairs, chair feet, and wisps.
// This is deliberately a little larger than the rasterized meshes but follows
// their real radial and vertical extents rather than an unrelated test shape.
const POKER_ENVELOPE = Array.from({ length: 64 }, (_, index) => index * Math.PI * 2 / 64)
  .flatMap((angle) => [-4.2, 3].map((y) => ({ x: Math.sin(angle) * 6.4, y, z: Math.cos(angle) * 6.4 })));

test('Poker camera remains finite across the cinematic orbit', () => {
  for (const aspect of [16 / 9, 4 / 3, 390 / 844]) {
    for (let step = 0; step <= 40; step++) {
      const progress = step / 40;
      const camera = pokerCinematicCamera(progress, aspect);
      const vp = cameraMatrices(camera, aspect).viewProjection;
      for (const point of POKER_ENVELOPE) {
        const clip = mat4MulVec4(vp, { ...point, w: 1 });
        const x = clip.x / clip.w, y = clip.y / clip.w;
        assert.ok(Number.isFinite(x), `non-finite horizontal projection at aspect ${aspect}, progress ${progress}`);
        assert.ok(Number.isFinite(y), `non-finite vertical projection at aspect ${aspect}, progress ${progress}`);
      }
    }
  }
});

test('every Poker creator wisp stays fully inside once the close-up reveals the table', () => {
  for (let aspect = 0.55; aspect <= 2.2; aspect += 0.05) {
    for (let step = 34; step <= 40; step++) {
      const camera = pokerCinematicCamera(step / 40, aspect);
      const vp = cameraMatrices(camera, aspect).viewProjection;
      for (let seat = 1; seat < 5; seat++) {
        const angle = pokerSeatAngle(seat, 5);
        const anchor = { x: Math.sin(angle) * 5.97, y: 2.2, z: Math.cos(angle) * 5.97 };
        const center = project(vp, anchor);
        const edge = project(vp, { ...anchor, y: anchor.y + 0.72 });
        const radius = Math.hypot(edge.x - center.x, edge.y - center.y);
        assert.ok(Math.abs(center.x) + radius < 0.97, `wisp ${seat} clipped horizontally at aspect ${aspect}, progress ${step / 40}`);
        assert.ok(Math.abs(center.y) + radius < 0.97, `wisp ${seat} clipped vertically at aspect ${aspect}, progress ${step / 40}`);
      }
    }
  }
});

test('Poker endpoint settles the felt near screen center across aspect ratios', () => {
  for (const aspect of [390 / 844, 4 / 3, 16 / 9, 2.2]) {
    const camera = pokerCinematicCamera(1, aspect);
    const table = project(cameraMatrices(camera, aspect).viewProjection, { x: 0, y: 0, z: 0 });
    const desired = aspect < 1.05 ? 0.18 : 0.08;
    assert.ok(Math.abs(table.y - desired) < 1e-6, `table center ${table.y} at aspect ${aspect}`);
  }
});

function project(vp: number[], point: { x: number; y: number; z: number }): { x: number; y: number } {
  const clip = mat4MulVec4(vp, { ...point, w: 1 });
  return { x: clip.x / clip.w, y: clip.y / clip.w };
}
