import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Texture } from '../../../engine/index.ts';
import type { ArchPlace } from './card-render.ts';
import { DeckShuffle } from './deck-shuffle.ts';

const THICK = 0.014;
const HALF_TOP = 13 * THICK;
const DECK_TOP = 27 * THICK;

const placements = (clock: number): ArchPlace[] => {
  const deck = new DeckShuffle({} as Texture, { x: 0, z: 0 });
  deck.setClock(clock);
  const place = (deck as unknown as { place(i: number): ArchPlace }).place.bind(deck);
  return Array.from({ length: 28 }, (_, i) => place(i));
};

const close = (actual: number, expected: number): void => {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
};

test('shuffle thickness: split packets stay half-height and bridge overlap becomes full-height', () => {
  const split = placements(0.55); // start of lift: both separated packets are settled
  close(split[26].y - split[0].y, HALF_TOP);
  close(split[27].y - split[1].y, HALF_TOP);

  const bridge = placements(2.35); // exact bridge apex / start of cascade
  close(bridge[26].edgeDepth - bridge[0].edgeDepth, HALF_TOP);
  close(bridge[27].edgeDepth - bridge[1].edgeDepth, HALF_TOP);
  close(bridge[27].depth - bridge[0].depth, DECK_TOP);
  assert.ok(Math.abs(bridge[0].x) < Math.abs(bridge[26].x), 'bottom cards should overlap more than top cards');
});

test('shuffle thickness: a riffle card keeps packet height until it mostly overlaps', () => {
  // Card 10 at this clock is halfway from packetX to overlapX. Its global interleaved
  // slot is higher, but that expansion is deliberately delayed until later in the slide.
  const rifflePhase = 10 * ((1 - 0.42) / 27) + 0.21;
  const riffle = placements(0.9 + rifflePhase * 0.75);
  close(riffle[10].y, 0.02);
  close(riffle[10].edgeDepth, 5 * THICK);
  close(riffle[10].depth, 5 * THICK);
  close(riffle[10].x, -0.65);
});

test('bridge occlusion: only the covering card exposes its inner short-edge border', () => {
  const bridge = placements(2.0);
  assert.equal(bridge[27].innerEdgeVisibility, 1);
  assert.ok(bridge.slice(0, 27).every((card) => card.innerEdgeVisibility === 0));
  assert.ok(bridge[27].x < Math.abs(bridge[26].x), 'top card should extend across the opposing packet');

  const cascade = placements(2.7);
  assert.equal(cascade[27].innerEdgeVisibility, 1);
  assert.ok(cascade.slice(0, 27).every((card) => card.innerEdgeVisibility === 0));
});

test('riffle occlusion: buried borders hand off before bridge while the top edge remains', () => {
  const lateRiffle = placements(1.6);
  assert.equal(lateRiffle[27].innerEdgeVisibility, 1);
  assert.ok(lateRiffle[26].innerEdgeVisibility < 1);
  assert.ok(lateRiffle[0].innerEdgeVisibility === 0);
  assert.ok(lateRiffle[27].curl < lateRiffle[26].curl, 'covering card should settle over the opposing packet');
});

test('shuffle orientation: every card keeps one yaw while bend direction mirrors by packet', () => {
  for (const clock of [0, 0.55, 0.9, 1.6, 2.0, 2.7, 3.2]) {
    const cards = placements(clock);
    assert.ok(cards.every((card) => card.yaw === Math.PI / 2), `card yaw changed at t=${clock}`);
    assert.ok(cards.every((card, i) => card.bendDirection === (i % 2 === 0 ? 1 : -1)));
  }
});

test('explicit shuffle clocks wrap so cinematic owners can play multiple complete cycles', () => {
  const first = placements(1.25);
  const second = placements(1.25 + 4.5);
  for (let i = 0; i < first.length; i++) {
    close(second[i].x, first[i].x);
    close(second[i].y, first[i].y);
    close(second[i].curl, first[i].curl);
  }
});
