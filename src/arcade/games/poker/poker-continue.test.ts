import assert from 'node:assert/strict';
import test from 'node:test';
import { RenderTarget } from '../../../engine/index.ts';
import { PokerGameScene, type PokerSeatView } from './poker-scene.ts';

const SEATS: PokerSeatView[] = [
  { kind: 'ai', label: 'AI 1', creator: 'openai' },
  { kind: 'ai', label: 'AI 2', creator: 'anthropic' },
];

interface ContinueInternals {
  cam: unknown;
  cine: { phase: 'wait'; clock: number; saved: unknown } | null;
}

test('a board-reveal gate starts at four seconds', () => {
  const scene = new PokerGameScene();
  scene.beginSession(SEATS);
  const internal = scene as unknown as ContinueInternals;
  internal.cine = { phase: 'wait', clock: 0, saved: internal.cam };
  const target = new RenderTarget(60, 30);
  scene.renderScene(target, 0);
  assert.equal(scene.continueCountdown(), 4);
  scene.cancelContinue();
});

test('an end-of-hand gate starts at six seconds and auto-advances', async () => {
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

test('the Space-triggered continue gesture advances a gate immediately', async () => {
  const scene = new PokerGameScene();
  scene.beginSession(SEATS);
  let resolved = false;
  const gate = scene.beginResult('AI 2 wins $80').then(() => {
    resolved = true;
  });
  const target = new RenderTarget(60, 30);
  scene.renderScene(target, 0);
  scene.continueGesture(); // onKeyImpl calls this only for Space
  assert.equal(scene.awaitingContinue(), false);
  assert.equal(scene.continueCountdown(), null);
  await gate;
  assert.equal(resolved, true);
});
