// The hero's own hole cards must stay face-down placeholders in the bottom-left strip
// until the hero actually peeks them on the felt (hover-to-peek) — then, and only then,
// the peeked card's rank/suit shows in its strip. Opponents stay hidden throughout (no
// spectator, no showdown here). This drives the REAL interaction path — render frames to
// land the opening deal, project a hero card to screen space, hoverCard() over it, settle
// the peek spring — and asserts tableView() reveals in step.

import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraMatrices, OrbitCamera, projectPoint, RenderTarget } from '../../../engine/index.ts';
import { HoldemState } from '../../../rules/poker/holdem.ts';
import { PokerGameScene } from './poker-scene.ts';
import { CARD_W } from './card-render.ts';
import { TABLE_RADIUS } from './table.ts';

// Geometry mirrored from poker-scene (the hero seat's resting hole-card slots).
const FOVY = (46 * Math.PI) / 180;
const HOLE_R = TABLE_RADIUS * 0.72;
const HOLE_GAP = 0.62 * CARD_W;
const CARD_LIFT = 0.08;

// A seeded, reproducible deal: two seats, hero on the button (heads-up).
function newHand(): HoldemState {
  let s = 0x1234;
  const rng = (): number => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  return new HoldemState({ stacks: [1000, 1000], button: 0, smallBlind: 10, bigBlind: 20, rng });
}

// Project a world point to NDC through the scene's over-the-shoulder pose (makeCamera).
function ndcOf(world: { x: number; y: number; z: number }, aspect: number): { x: number; y: number } {
  const cam = new OrbitCamera({ azimuth: 0, elevation: 0.7, distance: 13, target: { x: 0, y: 0, z: 0 } }, 3, 24);
  const vp = cameraMatrices(cam.toCamera({ fovy: FOVY, near: 0.05, far: 200 }), aspect).viewProjection;
  const point = projectPoint(vp, world);
  return { x: point.x, y: point.y };
}

test('hero hole cards stay placeholders until peeked, then reveal the peeked card', () => {
  const scene = new PokerGameScene();
  scene.beginSession([
    { kind: 'human', label: 'You' },
    { kind: 'ai', label: 'GPT', creator: 'openai' },
  ]);
  const hand = newHand();
  scene.beginHand(hand);

  const target = new RenderTarget(320, 200);
  const aspect = target.width / target.height;
  const frame = (n: number, t0: number): number => {
    let t = t0;
    for (let i = 0; i < n; i++) {
      t += 0.1;
      scene.renderScene(target, t);
    }
    return t;
  };

  // Land the opening deal + its post-deal hold (so the hero is peekable).
  let t = frame(60, 0);

  // Before any peek: the hero's own two cards read as placeholders, and the opponent's
  // are hidden too (heads-up, no spectator, pre-showdown).
  const before = scene.tableView();
  assert.ok(before, 'a session is running → tableView is non-null');
  assert.deepEqual(before.seats[0].cards, [null, null], 'unpeeked hero cards are hidden');
  assert.deepEqual(before.seats[1].cards, [null, null], 'opponent cards are hidden');
  assert.equal(before.seats[0].madeHand, '', 'no made-hand while the hand is unseen');

  // Peek the hero's LEFT card: hover exactly over its resting slot, then settle the spring.
  const left = ndcOf({ x: -HOLE_GAP, y: CARD_LIFT, z: HOLE_R }, aspect);
  scene.hoverCard(left.x, left.y, aspect);
  t = frame(12, t);

  const mid = scene.tableView();
  assert.ok(mid, 'still running');
  const heroCards = mid.seats[0].cards;
  const actualLeft = hand.holeOf(0)[0];
  assert.deepEqual(heroCards[0], actualLeft, 'the peeked (left) card now shows its true rank/suit');
  assert.equal(heroCards[1], null, 'the un-peeked (right) card stays a placeholder');
  assert.deepEqual(mid.seats[1].cards, [null, null], 'the opponent is still hidden');

  // Peek the RIGHT card too → the full hand shows. Its made-hand name is still blank
  // pre-flop (no board to make a hand with yet) — the reveal is card-by-card, not the
  // hand ranking.
  const right = ndcOf({ x: HOLE_GAP, y: CARD_LIFT, z: HOLE_R }, aspect);
  scene.hoverCard(right.x, right.y, aspect);
  frame(12, t);

  const after = scene.tableView();
  assert.ok(after, 'still running');
  assert.deepEqual(after.seats[0].cards, [hand.holeOf(0)[0], hand.holeOf(0)[1]], 'both hero cards now show');
  assert.equal(after.seats[0].madeHand, '', 'pre-flop → no made-hand yet even with both cards seen');
  assert.deepEqual(after.seats[1].cards, [null, null], 'the opponent is still hidden');

  // Deal a flop (heads-up: SB/button calls, BB checks) → with both hole cards seen and a
  // board out, the hero's made-hand now reads out; the still-hidden opponent's does not.
  while (hand.boardCards().length < 3 && !hand.isTerminal() && hand.toActSeat() >= 0) hand.applyAction({ type: 'call' });
  assert.ok(hand.boardCards().length >= 3, 'reached the flop');
  // The readout follows the felt, not the rules: let the three cards land first.
  for (let t = 0.1; t < 20 && scene.tableView()!.boardShown < 3; t += 0.1) scene.renderScene(target, t);
  const flop = scene.tableView();
  assert.ok(flop, 'still running');
  assert.notEqual(flop.seats[0].madeHand, '', 'both cards seen + board out → the hero made-hand reads out');
  assert.equal(flop.seats[1].madeHand, '', 'the hidden opponent has no made-hand readout');
});
