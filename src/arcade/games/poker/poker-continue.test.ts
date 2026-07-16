import assert from 'node:assert/strict';
import test from 'node:test';
import { RenderTarget } from '../../../engine/index.ts';
import { PokerGameScene, type PokerSeatView } from './poker-scene.ts';

const SEATS: PokerSeatView[] = [
  { kind: 'ai', label: 'AI 1', creator: 'openai' },
  { kind: 'ai', label: 'AI 2', creator: 'anthropic' },
];

test('a continue gate auto-advances after the countdown, releasing the driver waiter', async () => {
  const scene = new PokerGameScene();
  scene.beginSession(SEATS);
  let resolved = false;
  const gate = scene.beginResult('AI 1 wins $40').then(() => {
    resolved = true;
  });
  assert.equal(scene.awaitingContinue(), true);

  const target = new RenderTarget(60, 30);
  scene.renderScene(target, 0); // first frame arms the ~6s clock
  assert.equal(scene.continueCountdown(), 6);

  // Advance past the window (renderScene clamps dt to ≤0.1s/frame).
  let t = 0;
  for (let i = 0; i < 400 && scene.awaitingContinue(); i++) {
    t += 0.1;
    scene.renderScene(target, t);
  }
  assert.equal(scene.awaitingContinue(), false, 'the gate should auto-advance');
  assert.equal(scene.continueCountdown(), null);
  await gate;
  assert.equal(resolved, true, 'auto-advance releases beginResult’s waiter');
});

test('a keypress still advances a gate immediately (countdown not required)', async () => {
  const scene = new PokerGameScene();
  scene.beginSession(SEATS);
  let resolved = false;
  const gate = scene.beginResult('AI 2 wins $80').then(() => {
    resolved = true;
  });
  const target = new RenderTarget(60, 30);
  scene.renderScene(target, 0);
  scene.continueGesture(); // the user pressed a key
  assert.equal(scene.awaitingContinue(), false);
  assert.equal(scene.continueCountdown(), null);
  await gate;
  assert.equal(resolved, true);
});
