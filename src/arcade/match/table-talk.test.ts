import assert from 'node:assert/strict';
import test from 'node:test';
import type { Player } from '../../harness/player.ts';
import type { Move } from '../../rules/chess/types.ts';
import type { PokerAction } from '../../rules/poker/holdem.ts';
import { ChessGameScene } from '../games/chess/scene.ts';
import { PokerGameScene } from '../games/poker/poker-scene.ts';
import { AiMatch } from './driver.ts';
import { PokerMatch } from './poker-driver.ts';

// A seat that never moves (its turn waits on the abort signal) but answers when addressed,
// echoing what it was told so the test can see the conversation reached the prompt.
function listener<A>(name: string, seen: string[]): Player<A> {
  return {
    name,
    chooseAction: (_state, ctx) => new Promise((_resolve, reject) => ctx?.signal?.addEventListener('abort', () => reject(new Error('aborted')))),
    chooseCommunication: async ({ opportunity, conversation, gameView }) => {
      seen.push(conversation, gameView);
      return { mode: 'speak', intent: 'reply', text: `heard: ${opportunity.moment.publicSummary}`, privateReason: 'addressed' };
    },
  };
}

async function settle(until: () => boolean): Promise<void> {
  for (let i = 0; i < 50 && !until(); i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

test('chess: an @-addressed model replies through the chat thread with the recent talk in view', async () => {
  const chessGame = new ChessGameScene();
  const lines: { text: string; model: string; label: string }[] = [];
  const seen: string[] = [];
  const match = new AiMatch({
    chessGame,
    syncLive() {},
    requestRender() {},
    onCommentary: (text, model, label) => lines.push({ text, model, label }),
    allowIllegal: () => false,
    createPlayer: (seat) => (seat.kind === 'ai' ? listener<Move>('gpt', seen) : undefined) as Player<Move>,
  });
  match.start({ kind: 'human' }, { kind: 'ai', model: 'openai/gpt-5.4' });

  assert.equal(match.humanSeat(), 0);
  assert.deepEqual(match.chatTargets(), [{ seat: 1, label: 'gpt-5.4' }]);
  assert.equal(match.sendHumanChat('nice opening', []), true, 'unaddressed talk is accepted and prompts nobody');
  assert.equal(match.sendHumanChat('@gpt-5.4 what are you planning?', [1]), true);
  await settle(() => lines.length > 0);

  assert.equal(lines.length, 1);
  assert.equal(lines[0].model, 'openai/gpt-5.4');
  assert.equal(lines[0].label, 'gpt-5.4');
  assert.match(lines[0].text, /^heard: you directly addressed this player/);
  assert.match(seen[0], /nice opening/, 'the earlier unaddressed line is part of the conversation the model sees');
  assert.match(seen[1], /Position \(FEN\)/, 'the reply prompt carries the board');
  match.stop();
});

test('poker: only text-model seats are chat targets and a directed reply lands in the thread', async () => {
  const scene = new PokerGameScene();
  const lines: { text: string; model: string; label: string }[] = [];
  const seen: string[] = [];
  const match = new PokerMatch({
    scene,
    syncLive() {},
    requestRender() {},
    onCommentary: (text, model, label) => lines.push({ text, model, label }),
    onHandOver() {},
    createPlayer: (seat) => (seat.kind === 'ai' ? listener<PokerAction>('claude', seen) : undefined) as Player<PokerAction>,
  });
  match.start([{ kind: 'human' }, { kind: 'ai', model: 'anthropic/claude-haiku-4.5', runtime: 'text' }, { kind: 'bot' }]);

  assert.equal(match.humanSeat(), 0);
  assert.deepEqual(match.chatTargets(), [{ seat: 1, label: 'claude-haiku-4.5' }]);
  assert.equal(match.sendHumanChat('@claude-haiku-4.5 bluffing?', [1]), true);
  await settle(() => lines.some((line) => line.text.startsWith('heard:')));

  const reply = lines.find((line) => line.text.startsWith('heard:'));
  assert.ok(reply);
  assert.equal(reply.model, 'anthropic/claude-haiku-4.5');
  assert.equal(reply.label, 'claude-haiku-4.5');
  assert.match(seen[1], /hole cards|Your/i, 'the reply prompt carries the seat\'s own view of the hand');
  match.stop();
});
