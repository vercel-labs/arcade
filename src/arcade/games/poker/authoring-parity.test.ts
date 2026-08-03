import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { RenderTarget } from '../../../engine/index.ts';
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
  assert.equal(frameHash(liveTarget), 'cd5442774b6cf9c3b5db79326a210fc1d71ba7ba2b276ca96cd020f16a012ac5');

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
