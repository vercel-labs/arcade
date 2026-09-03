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
      { kind: 'ai', model: 'anthropic/claude-haiku-4.5', runtime: 'text' },
      { kind: 'ai', model: 'anthropic/claude-haiku-4.5', runtime: 'text' },
      { kind: 'ai', model: 'openai/gpt-5.4', runtime: 'text' },
    ],
    { stack: 1_000 },
  );

  assert.deepEqual(
    (({ smallBlind, bigBlind, level, hand, handsUntilNextLevel }) => ({ smallBlind, bigBlind, level, hand, handsUntilNextLevel }))(match.tournamentState()),
    { smallBlind: 10, bigBlind: 20, level: 1, hand: 1, handsUntilNextLevel: 15 },
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

test('practice bots seat as neutral AI views and the table never records', () => {
  const scene = new PokerGameScene();
  const match = new PokerMatch({
    scene,
    syncLive() {},
    requestRender() {},
    onCommentary() {},
    onHandOver() {},
  });
  match.start([{ kind: 'human' }, { kind: 'bot' }, { kind: 'bot' }]);
  assert.deepEqual(scene.tableView()?.seats.map((seat) => seat.name), ['You', 'bot 1', 'bot 2']);
  assert.deepEqual(scene.tableView()?.seats.map((seat) => seat.kind), ['human', 'ai', 'ai']);
  assert.deepEqual(match.noteObservers().map((o) => o.seat), [1, 2]); // bots show sample reads
  assert.ok(match.notesView(1).every((entry) => entry.notes.length > 0));
  assert.ok(match.isRunning());
  match.stop();
});
