import assert from 'node:assert/strict';
import test from 'node:test';
import { PointerField, samplePointerField } from './pointer-field.ts';

test('PointerField smooths motion, reports velocity, and fades after release', () => {
  const field = new PointerField({ idleDelay: 0.1, fadeRate: 20 });
  field.setInput({ x: 1, y: 0 });
  const moving = field.step(1 / 60);
  assert.ok(moving.x > 0.5 && moving.x < 1);
  assert.ok(moving.speed > 0 && moving.strength > 0);
  field.release();
  for (let i = 0; i < 30; i++) field.step(1 / 60);
  assert.ok(field.snapshot().strength < 0.01);
});

test('PointerField keeps a bounded, decaying velocity trail', () => {
  const field = new PointerField({ trailSpacing: 0.001, maxTrail: 4, trailLifetime: 0.1 });
  for (let i = 0; i < 8; i++) { field.setInput({ x: i / 7, y: 0.5 }); field.step(1 / 60); }
  assert.ok(field.snapshot().trail.length > 0 && field.snapshot().trail.length <= 4);
  assert.equal(new Set(field.snapshot().trail.map(({ id }) => id)).size, field.snapshot().trail.length);
  field.release();
  for (let i = 0; i < 12; i++) field.step(1 / 60);
  assert.equal(field.snapshot().trail.length, 0);
});

test('PointerField fills fast movement segments with multiple emission anchors', () => {
  const field = new PointerField({ response: 100, trailSpacing: 0.01, maxTrail: 20 });
  field.setInput({ x: 0.9, y: 0.5 });
  field.step(1 / 30);
  const trail = field.snapshot().trail;
  assert.ok(trail.length >= 5, `fast stroke emitted only ${trail.length} anchors`);
  const positions = [...trail].map(({ x }) => x).sort((a, b) => a - b);
  assert.ok(positions.at(-1)! - positions[0] > 0.15);
});

test('a new stroke does not connect to the previous release point', () => {
  const field = new PointerField({ response: 52, velocityResponse: 18, trailSpacing: 0.0045, maxTrail: 52 });
  field.beginStroke({ x: 0.15, y: 0.4 });
  field.setInput({ x: 0.25, y: 0.4 });
  field.step(1 / 60);
  field.release();
  field.beginStroke({ x: 0.85, y: 0.6 });
  const restarted = field.step(1 / 60);
  assert.equal(restarted.x, 0.85);
  assert.equal(restarted.y, 0.6);
  assert.equal(restarted.speed, 0);
  assert.ok(restarted.trail.every(({ x }) => x < 0.35 || x > 0.75), 'separate strokes must not emit a bridge');
});

test('high-response browser field keeps its emission head attached to the cursor', () => {
  const field = new PointerField({ response: 52, velocityResponse: 18, trailSpacing: 0.0045 });
  field.setInput({ x: 0.92, y: 0.18 });
  const frame = field.step(1 / 60);
  assert.ok(Math.hypot(frame.x - 0.92, frame.y - 0.18) < 0.23);
  field.step(1 / 60);
  const next = field.snapshot();
  assert.ok(Math.hypot(next.x - 0.92, next.y - 0.18) < 0.1);
  assert.ok(next.trail[0] && Math.hypot(next.trail[0].x - next.x, next.trail[0].y - next.y) < 0.01);
});

test('raw pointer head is exact on the input event even while its wake is smoothed', () => {
  const field = new PointerField({ response: 8 });
  field.setInput({ x: 0.93, y: 0.07 });
  const snapshot = field.snapshot();
  assert.equal(snapshot.rawX, 0.93);
  assert.equal(snapshot.rawY, 0.07);
  assert.notEqual(snapshot.x, snapshot.rawX);
});

test('click smoke triangle expands, drifts, persists, and fully expires', () => {
  const field = new PointerField(); field.burst(0.5, 0.5, 48);
  const start = field.snapshot();
  assert.equal(start.bursts.length, 48);
  field.step(0.1);
  const expanded = field.snapshot();
  assert.ok(expanded.bursts.some((particle) => Math.hypot(particle.x - 0.5, particle.y - 0.5) > 0.015));
  assert.ok(expanded.bursts.some((particle) => particle.y < 0.5));
  for (let i=0;i<5;i++) field.step(0.1);
  assert.ok(field.snapshot().bursts.length > 0, 'smoke ring should linger beyond the old compact burst');
  for (let i=0;i<20;i++) field.step(0.1);
  assert.equal(field.snapshot().bursts.length, 0);
});

test('click burst forms a loose hollow triangle with per-click variation', () => {
  const field = new PointerField();
  field.burst(0.5, 0.5, 90);
  field.step(0.24);
  const first = field.snapshot().bursts;
  const radii = first.map((particle) => Math.hypot(particle.x - 0.5, particle.y - 0.5));
  assert.ok(radii.filter((radius) => radius < 0.012).length < first.length * 0.12, 'triangle center should remain mostly hollow');
  const sectors = new Set(first.map((particle) => Math.floor((((Math.atan2(particle.y - 0.5, particle.x - 0.5) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2)) * 6)));
  assert.ok(sectors.size >= 5, 'smoke should occupy the complete triangular perimeter');

  const second = new PointerField();
  second.burst(0.5, 0.5, 90);
  second.burst(0.5, 0.5, 90);
  second.step(0.24);
  const later = second.snapshot().bursts.slice(90);
  assert.notDeepEqual(first.slice(0, 12).map(({ vx, vy }) => [vx, vy]), later.slice(0, 12).map(({ vx, vy }) => [vx, vy]));
});

test('pointer field sampling has a bright center and finite spectral rim', () => {
  const field = new PointerField(); field.setInput({ x: 0.5, y: 0.5 });
  for (let i = 0; i < 20; i++) field.step(1 / 60);
  const snapshot = field.snapshot();
  assert.ok(samplePointerField(snapshot, 0.5, 0.5).influence > 0.5);
  assert.ok(samplePointerField(snapshot, 0.61, 0.5).rim > 0);
  assert.equal(samplePointerField(snapshot, 0.9, 0.9).influence, 0);
});
