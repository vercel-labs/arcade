import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { RenderTarget } from '../../../engine/index.ts';
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
  assert.equal(frameHash(liveTarget), '5f33e57a99004b9e0c5e0c6c43d0431ae4a0cf0835ad42c44a3bf1f71b2bbde1');

  const cases: { mode: CardsMode; expected: string }[] = [
    { mode: 'single', expected: '601ade6633a8a6da8bae7812f6d9126310dfa27ded03eb5ba02aafff57da771e' },
    { mode: 'hand', expected: 'a94ea76cc3f96b6619f70c2ec4bf271de0836b024ade81bc02b2d48477e6ee36' },
    { mode: 'deck', expected: '29d51e9fa2d253ffc9f599b93ccec0bb3844aa8ab3868fec72b22cf977ab9b3e' },
  ];
  for (const entry of cases) {
    const scene = new CardsScene();
    scene.setMode(entry.mode);
    const target = new RenderTarget(96, 64);
    scene.renderScene(target, 0);
    assert.equal(frameHash(target), entry.expected, entry.mode);
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
