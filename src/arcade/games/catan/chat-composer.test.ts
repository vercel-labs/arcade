import assert from 'node:assert/strict';
import test from 'node:test';
import {
  catanChatMentionCandidates,
  completeCatanChatMention,
  parseCatanChatMentions,
  type ChatTarget,
} from './chat-composer.ts';

const targets: ChatTarget[] = [
  { seat: 1, label: 'claude-haiku-4.5' },
  { seat: 2, label: 'gpt-5.4-nano' },
  { seat: 3, label: 'gemini-2.5-flash' },
];

test('Catan chat @ suggestions filter and complete at the caret', () => {
  assert.deepEqual(catanChatMentionCandidates('hey @cl', 7, targets).map((target) => target.seat), [1]);
  assert.deepEqual(catanChatMentionCandidates('@g', 2, targets).map((target) => target.seat), [2, 3]);
  assert.deepEqual(completeCatanChatMention('hey @cl later', 7, targets[0]), {
    value: 'hey @claude-haiku-4.5  later',
    caret: 22,
  });
});

test('Catan chat parses one or several exact player mentions', () => {
  assert.deepEqual(parseCatanChatMentions(
    '@claude-haiku-4.5 can you trade? @gpt-5.4-nano, what about you?',
    targets,
  ), [1, 2]);
  assert.deepEqual(parseCatanChatMentions('email@example.com is not a player mention', targets), []);
});
