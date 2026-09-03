import assert from 'node:assert/strict';
import test from 'node:test';
import { cameraMatrices } from '../engine/camera.ts';
import { mat4MulVec4 } from '../engine/math.ts';
import { pokerSeatAngle } from '../game-visuals/poker/layout.ts';
import { chessCinematicPose, pokerCinematicCamera } from './camera.ts';

test('Chess camera keeps the Claude king wisp in frame throughout its close orbit', () => {
  const anchor = { x: 0.525, y: 2.7, z: 3.675 };
  for (let step = 0; step <= 160; step++) {
    const pose = chessCinematicPose(step / 160);
    const ce = Math.cos(pose.elevation);
    const camera = {
      eye: {
        x: pose.target.x + ce * Math.sin(pose.azimuth) * pose.distance,
        y: pose.target.y + Math.sin(pose.elevation) * pose.distance,
        z: pose.target.z + ce * Math.cos(pose.azimuth) * pose.distance,
      },
      target: pose.target, up: { x: 0, y: 1, z: 0 }, fovy: 48 * Math.PI / 180, near: 0.05, far: 100,
    };
    const vp = cameraMatrices(camera, 16 / 9).viewProjection;
    const center = project(vp, anchor);
    const edge = project(vp, { ...anchor, y: anchor.y + 0.58 });
    const radius = Math.hypot(edge.x - center.x, edge.y - center.y);
    assert.ok(Math.abs(center.x) + radius < 1, `Claude wisp clipped horizontally at ${step / 160}`);
    assert.ok(Math.abs(center.y) + radius < 1, `Claude wisp clipped vertically at ${step / 160}`);
  }
});

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

test('Poker camera path remains outside every creator wisp volume', () => {
  for (let step = 0; step <= 160; step++) {
    const camera = pokerCinematicCamera(step / 160, 16 / 9);
    for (let seat = 0; seat < 5; seat++) {
      const angle = pokerSeatAngle(seat, 5);
      const anchor = { x: Math.sin(angle) * 5.97, y: 2.2, z: Math.cos(angle) * 5.97 };
      assert.ok(Math.hypot(camera.eye.x - anchor.x, camera.eye.y - anchor.y, camera.eye.z - anchor.z) > 3, `camera intersects wisp ${seat} at ${step / 160}`);
    }
  }
});

test('every Poker creator wisp stays visible once the close-up reveals the table', () => {
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
        assert.ok(center.y - radius > -0.97, `wisp ${seat} billboard clipped below the viewport at aspect ${aspect}, progress ${step / 40}`);
        assert.ok(center.y + radius < 0.99, `wisp ${seat} billboard clipped above the viewport at aspect ${aspect}, progress ${step / 40}`);
      }
    }
  }
});

test('Poker endpoint settles the felt near screen center across aspect ratios', () => {
  for (const aspect of [390 / 844, 4 / 3, 16 / 9, 2.2]) {
    const camera = pokerCinematicCamera(1, aspect);
    const table = project(cameraMatrices(camera, aspect).viewProjection, { x: 0, y: 0, z: 0 });
    const desired = -0.01;
    assert.ok(Math.abs(table.y - desired) < 1e-6, `table center ${table.y} at aspect ${aspect}`);
  }
});

test('Poker keeps the felt centered throughout its rotation and pullback', () => {
  for (const aspect of [390 / 844, 4 / 3, 16 / 9, 2.2]) {
    const ys = Array.from({ length: 41 }, (_, step) => project(cameraMatrices(pokerCinematicCamera(step / 40, aspect), aspect).viewProjection, { x: 0, y: 0, z: 0 }).y);
    const velocity = ys.slice(1).map((y, index) => y - ys[index]);
    const maxStep = aspect < 1.05 ? 0.065 : 0.045;
    assert.ok(Math.max(...velocity.map(Math.abs)) < maxStep, `table framing jumped at aspect ${aspect}`);
    assert.ok(Math.abs(ys.at(-1)! + 0.01) < 1e-6, `ending table center ${ys.at(-1)} at aspect ${aspect}`);
  }
});

test('Poker keeps late creator billboards within the frame', () => {
  for (const aspect of [4 / 3, 16 / 9, 2.2]) {
    for (let step = 26; step <= 40; step++) {
      const camera = pokerCinematicCamera(step / 40, aspect);
      const vp = cameraMatrices(camera, aspect).viewProjection;
      for (let seat = 1; seat < 5; seat++) {
        const angle = pokerSeatAngle(seat, 5);
        const anchor = { x: Math.sin(angle) * 5.97, y: 2.2, z: Math.cos(angle) * 5.97 };
        const center = project(vp, anchor);
        const edge = project(vp, { ...anchor, y: anchor.y + 0.82 });
        const radius = Math.hypot(edge.x - center.x, edge.y - center.y);
        assert.ok(Math.abs(center.x) + radius < 0.97, `wisp ${seat} clipped horizontally at aspect ${aspect}, progress ${step / 40}`);
        assert.ok(center.y - radius > -0.97, `wisp ${seat} billboard clipped below the viewport at aspect ${aspect}, progress ${step / 40}`);
        assert.ok(center.y + radius < 0.99, `wisp ${seat} billboard clipped above the viewport at aspect ${aspect}, progress ${step / 40}`);
      }
    }
  }
});

test('Poker endpoint retains the preferred closer table scale', () => {
  for (const [aspect, maximum] of [[1, 18.1], [16 / 9, 13.6], [2.2, 13.6]] as const) {
    const camera = pokerCinematicCamera(1, aspect);
    const distance = Math.hypot(
      camera.eye.x - camera.target.x,
      camera.eye.y - camera.target.y,
      camera.eye.z - camera.target.z,
    );
    assert.ok(distance <= maximum, `Poker endpoint pulled back too far at aspect ${aspect}: ${distance}`);
  }
});

function project(vp: number[], point: { x: number; y: number; z: number }): { x: number; y: number } {
  const clip = mat4MulVec4(vp, { ...point, w: 1 });
  return { x: clip.x / clip.w, y: clip.y / clip.w };
}
