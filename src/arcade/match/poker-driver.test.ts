import assert from 'node:assert/strict';
import test from 'node:test';

import { PokerGameScene } from '../games/poker/poker-scene.ts';
import { PokerMatch } from './poker-driver.ts';

test('duplicate poker slugs reach the live player-strip view with visible indices', () => {
  const scene = new PokerGameScene();
  const match = new PokerMatch({
    scene,
    syncLive() {},
    requestRender() {},
    onCommentary() {},
    onHandOver() {},
  });

  match.start(
    [
      { kind: 'ai', model: 'anthropic/claude-haiku-4.5' },
      { kind: 'ai', model: 'anthropic/claude-haiku-4.5' },
      { kind: 'ai', model: 'openai/gpt-5.4' },
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
