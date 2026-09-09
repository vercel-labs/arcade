import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { RenderTarget } from '../../../engine/index.ts';
import { assertFrameSignature } from '../frame-signature.ts';
import { mulberry32 } from '../../../engine/index.ts';
import { HoldemState } from '../../../rules/poker/holdem.ts';
import { CardsScene, type CardsMode } from './cards-scene.ts';
import { PokerGameScene } from './poker-scene.ts';

function frameHash(target: RenderTarget): string {
  return createHash('sha256')
    .update(Buffer.from(target.color.buffer))
    .update(Buffer.from(target.depth.buffer))
    .digest('hex');
}


test('authored Poker composition preserves live-idle and card-showcase baselines', () => {
  const live = new PokerGameScene();
  const liveTarget = new RenderTarget(96, 64);
  live.renderScene(liveTarget, 0);
  // Shared production card-back texture (also used by the browser cinematic).
  assertFrameSignature(liveTarget, 'BgoIBgoIBgoIBgoIBgoIBgoIBgoIBgoIBgoIBgoIBgoIBgoIBgoIBgoIBgoIBgoICw0KLCIVLSIVCw0KBgoIBgoIBgoIBgoIBgoICw0KGB0TGisaNkU9LCsfKykfESwbKjEjIikhCw0KBgoIFBMNQjUpVDUwCykZCykZOy8mOiwjCykZEC0ebkpMQzUqFBMNKi8dYiMjTkA9CysaDCwbO1FEO1FEDCwbCykZMiceTiEdLjAdHDEhUmJiIzs2DCwbCyoaDCwbCykZCyoaCykZCykZCykZGS8cHS8cIT8vCyoaCykZKzYqOjowOjowPj42U01KGTYoCyoZHjAdOjMfDSsaCyoZCyoaWyEgeDM1eDM1YSYnRl5XJ0lKDC0bPzUg', 'live idle');

  const cases: { mode: CardsMode; expected: string }[] = [
    { mode: 'single', expected: 'DA0RDA0RDA0RISIlRUZIRUZIRUZIRUZIISIlDA0RDA0RDA0RDA0RDA0RDA0RNzc6vr278e/s8e/s8e/sRUZIDA0RDA0RDA0RDA0RDA0RDA0RRUZI4N7b8e/s8e/s8e/sRUZIDA0RDA0RDA0RDA0RDA0RDA0RRUZI8e/subi2u7q48e/sRUZIDA0RDA0RDA0RDA0RDA0RDA0RMDAz8e/snZybpKOh8e/sMDAzDA0RDA0RDA0RDA0RDA0RDA0RKSks8e/s8e/s8e/s4N7bKSksDA0RDA0RDA0RDA0RDA0RDA0RJSYp1dPQ1dPQ1dPQoaCfJSYpDA0RDA0RDA0RDA0RDA0RDA0RDA0RDA0RDA0RDA0RDA0RDA0RDA0RDA0RDA0R' },
    { mode: 'hand', expected: 'BgoIBgoIBgoIBgoIBgoIBgoIBgoIBgoIBgoIBgoIBgoIBgoIBgoICQwJFRcPGCAUEyEVFSUXFSUXEiEVGCAUFhgQCQwJBgoIIiMWGi4cCykZCykZCykZCykZCyoZCykZCykZCykZGSwbIiMWCykZDS8dCyoaCysaCyoaDCwbDCwbDCsbCysaDCwbCyoaCykZDCwbCykZCyoaDC0bNSYePighPikhNikgCysaCykZCykZCysaCykZCysaCykZDS8dfTI1ZysqZysqfTI1CykZCyoaDTAdCykZCyoaCykZCykZCykZCykZDCwbCykZCykZCykZDC0cCyoaDC0cCyoaCykZCysaCykZCysaCysaCykZCykZCykZCysaDC0cDCsb' },
    { mode: 'deck', expected: 'BgoIBgoIBgoIBgoIBgoIExIMExIMBgoIBgoIBgoIBgoIBgoIBgoIBgoIBgoIBgoIFBcPHiEVHiIVExUOBgoIBgoIBgoIBgoICQwJBgoIDQ8LGScYCykZCysaCykZDCoZGSgZDQ8LBgoICQwJJh0TFRMNISwbCyoaCykZKiIYKyMZCykZCykZHSkZFRMNJh0TMSQWQC0cDSwbCykZCysaEi8fEi8fDCwbCysaDCkZQC0cMiQXEBALTzchEy0cCysaCykZCysaCykZDCwbCykZEywbTzchEBALBgoICQwJJigZCysaCykZDC4cDCwbCykZDC0bJikZCQwJBgoIBgoIBgoICw0KLysaJjIeEC0bECwbJzIeMCsaCw0KBgoIBgoI' },
  ];
  for (const entry of cases) {
    const scene = new CardsScene();
    scene.setMode(entry.mode);
    const target = new RenderTarget(96, 64);
    scene.renderScene(target, 0);
    assertFrameSignature(target, entry.expected, entry.mode);
  }
});

test('cached Poker idle base preserves an unchanged animated frame', () => {
  const scene = new PokerGameScene();
  const first = new RenderTarget(96, 64);
  const cached = new RenderTarget(96, 64);
  scene.renderScene(first, 0);
  scene.renderScene(cached, 0);
  assert.equal(frameHash(cached), frameHash(first));
});

test('active Poker environment cache preserves exact color and depth across camera and viewport changes', () => {
  const seats = [
    { kind: 'human' as const, label: 'You' },
    { kind: 'ai' as const, label: 'AI 2' },
    { kind: 'ai' as const, label: 'AI 3' },
    { kind: 'ai' as const, label: 'AI 4' },
  ];
  const cached = new PokerGameScene();
  const uncached = new PokerGameScene({ cacheActiveEnvironment: false });
  for (const scene of [cached, uncached]) {
    scene.beginSession(seats);
    scene.beginHand(new HoldemState({
      stacks: seats.map(() => 1_000),
      button: 0,
      smallBlind: 10,
      bigBlind: 20,
      rng: mulberry32(0x90ce7),
    }));
  }
  const compare = (width: number, height: number, time: number): void => {
    const a = new RenderTarget(width, height);
    const b = new RenderTarget(width, height);
    cached.renderScene(a, time);
    uncached.renderScene(b, time);
    assert.equal(frameHash(a), frameHash(b));
  };

  compare(168, 96, 0);
  compare(168, 96, 0);
  cached.orbit(5, -2);
  uncached.orbit(5, -2);
  compare(168, 96, 0);
  compare(210, 120, 0);
});
