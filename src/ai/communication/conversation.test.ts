import assert from 'node:assert/strict';
import test from 'node:test';
import { PublicConversation, sanitizeTableTalk } from './conversation.ts';

test('public conversation is bounded, sanitized, and creates direct-response obligations', () => {
  const conversation = new PublicConversation(2);
  const human = conversation.appendHuman(0, 'the human player', '  hello\u0000 there  ', [1]);
  assert.equal(human?.text, 'hello there');
  assert.equal(conversation.requiredResponseFor(1), human?.id);
  conversation.appendModel(2, 'Gemini', 'First');
  conversation.appendModel(1, 'Claude', 'I hear you.');
  assert.equal(conversation.all().length, 2);
  assert.match(conversation.promptFor(1), /directly addressed/);
  conversation.consumeResponseFor(1);
  assert.equal(conversation.requiredResponseFor(1), undefined);
  assert.equal(sanitizeTableTalk('\u0007a   b'), 'a b');
});
