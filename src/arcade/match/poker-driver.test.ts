import assert from 'node:assert/strict';
import test from 'node:test';

import { PokerGameScene } from '../games/poker/poker-scene.ts';
import { PokerMatch } from './poker-driver.ts';

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

test('duplicate poker slugs reach the live player-strip view with visible indices', () => {
  const scene = new PokerGameScene();
  const match = new PokerMatch({
    scene,
    syncLive() {},
    requestRender() {},
    onCommentary() {},
    onHandOver() {},
    onError(error) {
      assert.fail(`unexpected match error: ${String(error)}`);
    },
  });

  match.start(
    [
      { kind: 'ai', model: 'anthropic/claude-haiku-4.5', runtime: 'text' },
      { kind: 'ai', model: 'anthropic/claude-haiku-4.5', runtime: 'text' },
      { kind: 'ai', model: 'openai/gpt-5.4', runtime: 'text' },
    ],
    { stack: 1_000 },
  );

  assert.deepEqual(
    scene.tableView()?.seats.map((seat) => seat.name),
    ['claude-haiku-4.5 (1)', 'claude-haiku-4.5 (2)', 'gpt-5.4'],
  );

  match.setSeatModel(2, 'anthropic/claude-haiku-4.5');
  assert.deepEqual(
    scene.tableView()?.seats.map((seat) => seat.name),
    ['claude-haiku-4.5 (1)', 'claude-haiku-4.5 (2)', 'claude-haiku-4.5 (3)'],
  );
  match.stop();
});

test('deal failures are reported while active, but ignored after cancellation', async () => {
  const failure = new Error('deal animation failed');
  class BrokenDealScene extends PokerGameScene {
    override awaitDeal(): Promise<void> {
      return Promise.reject(failure);
    }
  }

  const errors: unknown[] = [];
  const reportError = (error: unknown): void => {
    errors.push(error);
  };
  const active = new PokerMatch({
    scene: new BrokenDealScene(),
    syncLive() {},
    requestRender() {},
    onCommentary() {},
    onHandOver() {},
    onError: reportError,
  });
  active.start([{ kind: 'human' }, { kind: 'human' }]);
  await settle();
  assert.deepEqual(errors, [failure]);
  active.stop();

  const cancelled = new PokerMatch({
    scene: new BrokenDealScene(),
    syncLive() {},
    requestRender() {},
    onCommentary() {},
    onHandOver() {},
    onError: reportError,
  });
  cancelled.start([{ kind: 'human' }, { kind: 'human' }]);
  cancelled.stop();
  await settle();
  assert.deepEqual(errors, [failure]);
});
