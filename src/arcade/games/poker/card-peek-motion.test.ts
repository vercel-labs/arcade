import assert from 'node:assert/strict';
import test from 'node:test';
import { HandPeek, PEEK } from './card-peek.ts';
import { peekCardCenter } from './card-render.ts';

const CARD = { rank: 12 as const, suit: 3 as const };

test('peek-to-full pose advances without a mid-transition speed burst', () => {
  const points = Array.from({ length: 21 }, (_, i) =>
    peekCardCenter({ seatX: 0, seatZ: 4.6, reveal: PEEK + ((1 - PEEK) * i) / 20, peek: PEEK, az: 0 }),
  );
  const distances = points.slice(1).map((point, i) => Math.hypot(point.y - points[i].y, point.z - points[i].z));

  // The spring controls timing; equal reveal increments should not nearly stop,
  // then accelerate through the middle of the geometric pose transition.
  for (let i = 1; i < distances.length; i++) {
    assert.ok(distances[i] <= distances[i - 1] + 1e-9, `segment ${i} sped up: ${distances[i - 1]} -> ${distances[i]}`);
  }
});

test('clicking a lifting card down reverses it on the next frame', () => {
  const hand = new HandPeek(4.6);
  hand.reset([{ card: CARD, seatX: 0 }]);
  hand.setHovered(0);
  for (let i = 0; i < 90; i++) hand.step(1 / 60); // settle at the hover peek

  hand.flipCard(0);
  for (let i = 0; i < 6; i++) hand.step(1 / 60); // moving quickly toward fully upright
  const before = hand.reveal(0);
  assert.ok(before !== undefined && before > PEEK);

  hand.flipCard(0);
  hand.step(1 / 60);
  const after = hand.reveal(0);
  assert.ok(after !== undefined && after < before, `card kept rising after down-click: ${before} -> ${after}`);
});

test('seat-oriented peeks retain their resting yaw while hero defaults remain unchanged', () => {
  const hero = peekCardCenter({ seatX: 0, seatZ: 4.6, reveal: PEEK, peek: PEEK, az: 0 });
  const explicitHero = peekCardCenter({ seatX: 0, seatZ: 4.6, reveal: PEEK, peek: PEEK, restAz: 0, az: 0 });
  assert.deepEqual(explicitHero, hero);
  const side = peekCardCenter({ seatX: 4.6, seatZ: 0, reveal: PEEK, peek: PEEK, restAz: Math.PI / 2, az: Math.PI / 2 });
  assert.ok(Math.abs(side.x - 4.6) > Math.abs(side.z), 'side-seat curl should extend toward its seated viewer');
});
