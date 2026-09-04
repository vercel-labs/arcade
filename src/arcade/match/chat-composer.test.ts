import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chatMentionCandidates,
  completeChatMention,
  parseChatMentions,
  type ChatTarget,
} from './chat-composer.ts';

const targets: ChatTarget[] = [
  { seat: 1, label: 'claude-haiku-4.5' },
  { seat: 2, label: 'gpt-5.4-nano' },
  { seat: 3, label: 'gemini-2.5-flash' },
];

test('Islanders chat @ suggestions filter and complete at the caret', () => {
  assert.deepEqual(chatMentionCandidates('hey @cl', 7, targets).map((target) => target.seat), [1]);
  assert.deepEqual(chatMentionCandidates('@g', 2, targets).map((target) => target.seat), [2, 3]);
  assert.deepEqual(completeChatMention('hey @cl later', 7, targets[0]), {
    value: 'hey @claude-haiku-4.5  later',
    caret: 22,
  });
});

test('Islanders chat parses one or several exact player mentions', () => {
  assert.deepEqual(parseChatMentions(
    '@claude-haiku-4.5 can you trade? @gpt-5.4-nano, what about you?',
    targets,
  ), [1, 2]);
  assert.deepEqual(parseChatMentions('email@example.com is not a player mention', targets), []);
});
