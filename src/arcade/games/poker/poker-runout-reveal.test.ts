import assert from 'node:assert/strict';
import test from 'node:test';
import { RenderTarget } from '../../../engine/index.ts';
import { HoldemState } from '../../../rules/poker/holdem.ts';
import { PokerGameScene } from './poker-scene.ts';

// A seeded heads-up deal that goes all-in before the flop, so the closing call turns the
// whole board at once and the hand is decided with five cards still to land.
function allInHand(): HoldemState {
  let s = 0x5eed;
  const rng = (): number => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  return new HoldemState({ stacks: [1000, 1000], button: 0, smallBlind: 10, bigBlind: 20, rng });
}

test('an all-in run-out reveals nothing until the last community card lands', async () => {
  const scene = new PokerGameScene();
  scene.beginSession([
    { kind: 'ai', label: 'GPT', creator: 'openai' },
    { kind: 'ai', label: 'Claude', creator: 'anthropic' },
  ]);
  const events: string[] = [];
  scene.setEventSink((text) => events.push(text));
  const hand = allInHand();
  scene.beginHand(hand);
  const target = new RenderTarget(60, 30);
  scene.renderScene(target, 0);

  void scene.playMove({ type: 'allin' });
  const settle = scene.playMove({ type: 'call' });
  assert.equal(hand.isTerminal(), true, 'the rules decide the hand at the call');
  assert.equal(hand.boardCards().length, 5);

  // Right after the call, and while the board is still dealing, nothing gives the result away.
  let t = 0;
  const step = (): void => {
    t += 0.1;
    scene.renderScene(target, t);
  };
  step();
  const during = scene.tableView()!;
  assert.ok(during.boardShown < 5, `the run-out is still dealing (${during.boardShown} landed)`);
  assert.equal(during.ended, false);
  assert.deepEqual(during.seats.map((seat) => seat.award), [0, 0]);
  assert.deepEqual(during.seats.map((seat) => seat.madeHand), ['', '']);
  assert.notEqual(during.street, 'showdown');
  assert.equal(events.some((line) => /wins|split/.test(line)), false, 'no winner line in the transcript yet');

  for (let i = 0; i < 200 && scene.tableView()!.boardShown < 5; i++) step();
  step();
  const after = scene.tableView()!;
  assert.equal(after.boardShown, 5);
  assert.equal(after.ended, true);
  assert.ok(after.seats.some((seat) => seat.award > 0), 'the pot is awarded once the river has landed');
  assert.equal(after.street, hand.streetName());
  assert.equal(events.filter((line) => /wins|split/.test(line)).length, 1, 'the winner line arrives with the river');

  scene.continueGesture();
  await settle;
  scene.endSession();
});

test('a hand that ends on a fold reveals its result at once', () => {
  const scene = new PokerGameScene();
  scene.beginSession([
    { kind: 'ai', label: 'GPT', creator: 'openai' },
    { kind: 'ai', label: 'Claude', creator: 'anthropic' },
  ]);
  const events: string[] = [];
  scene.setEventSink((text) => events.push(text));
  const hand = allInHand();
  scene.beginHand(hand);
  void scene.playMove({ type: 'fold' });
  assert.equal(hand.isTerminal(), true);
  const view = scene.tableView()!;
  assert.equal(view.ended, true);
  assert.ok(view.seats.some((seat) => seat.award > 0));
  assert.equal(events.filter((line) => /wins/.test(line)).length, 1);
  scene.cancelContinue();
  scene.endSession();
});
