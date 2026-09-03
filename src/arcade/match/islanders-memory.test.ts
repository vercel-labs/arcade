import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MockLanguageModelV3 } from 'ai/test';
import { IslandersMemory, MAX_NOTES } from './islanders-memory.ts';

const labels = ['the human player', 'claude', 'gemini'];
const labelOf = (seat: number): string => labels[seat];

function mockReflect(reply: { plan: string; players: { player: string; notes: string[] }[] }): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doGenerate: async () =>
      ({
        content: [{ type: 'text', text: JSON.stringify(reply) }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
        warnings: [],
      }) as unknown as Awaited<ReturnType<MockLanguageModelV3['doGenerate']>>,
  });
}

test('the notebook is empty until a reflection, then renders a plan and reads by name', async () => {
  const memory = new IslandersMemory();
  assert.equal(memory.renderForPrompt(1, [0, 2], labelOf), '');
  await memory.reflect({
    model: mockReflect({
      plan: 'Reach the 3:1 port before gemini and stop offering ore.',
      players: [
        { player: 'the human player', notes: ['Rejected both of my ore offers; wants brick.', 'Robbed me twice — treats me as the leader.', 'extra 1', 'extra 2'] },
        { player: 'GEMINI', notes: ['Accepts fair 1:1 trades.'] },
        { player: 'nobody here', notes: ['ignored'] },
      ],
    }),
    observer: 1,
    subjects: [0, 2],
    digest: ['- claude: rolled 8; offered 1 ore for 1 brick (rejected by everyone → no deal); ended the turn.'],
    talk: ['the human player: not trading ore, sorry'],
    labelOf,
  });
  assert.equal(memory.plan(1), 'Reach the 3:1 port before gemini and stop offering ore.');
  assert.equal(memory.get(1, 0).length, MAX_NOTES, 'notes are capped');
  assert.deepEqual(memory.get(1, 2), ['Accepts fair 1:1 trades.']);
  const rendered = memory.renderForPrompt(1, [0, 2], labelOf);
  assert.match(rendered, /^Your private notebook/);
  assert.match(rendered, /- Plan: Reach the 3:1 port/);
  assert.match(rendered, /- the human player: Rejected both of my ore offers; wants brick\.; Robbed me twice/);
  assert.match(rendered, /- gemini: Accepts fair 1:1 trades\./);
  // Another seat's notebook is untouched.
  assert.equal(memory.renderForPrompt(2, [0, 1], labelOf), '');
});

test('a failed reflection keeps the previous notebook', async () => {
  const memory = new IslandersMemory();
  await memory.reflect({ model: mockReflect({ plan: 'Build toward wheat.', players: [{ player: 'gemini', notes: ['Hoards ore.'] }] }), observer: 1, subjects: [0, 2], digest: [], talk: [], labelOf });
  const throwing = new MockLanguageModelV3({ doGenerate: async () => { throw new Error('provider exploded'); } });
  await memory.reflect({ model: throwing, observer: 1, subjects: [0, 2], digest: [], talk: [], labelOf });
  assert.equal(memory.plan(1), 'Build toward wheat.');
  assert.deepEqual(memory.view(1, [0, 2]), [{ subject: 0, notes: [] }, { subject: 2, notes: ['Hoards ore.'] }]);
  memory.reset();
  assert.equal(memory.renderForPrompt(1, [0, 2], labelOf), '');
});
