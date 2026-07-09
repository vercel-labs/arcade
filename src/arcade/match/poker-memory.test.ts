import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockLanguageModelV3 } from 'ai/test';
import { type Card, parseCard } from '../../rules/poker/cards.ts';
import type { HandPublicRecord } from '../../rules/poker/holdem.ts';
import { buildHandDigest, MAX_NOTES, PokerMemory } from './poker-memory.ts';

// Seat labels for a 3-handed table: seat 0 is the human, 1 and 2 are models.
const LABELS = ['the human', 'claude-opus-4.8', 'gpt-5.4'];
const labelOf = (seat: number): string => LABELS[seat] ?? `P${seat}`;

const cards = (s: string): Card[] =>
  s.split(' ').map((t) => {
    const c = parseCard(t);
    if (!c) throw new Error(`bad test card: ${t}`);
    return c;
  });

function sampleRecord(): HandPublicRecord {
  return {
    button: 0,
    sb: 1,
    bb: 2,
    street: 'river',
    board: cards('Ah Kd 7c 2s 9h'),
    log: ['[preflop] P1 raises to 60', 'P2 calls', 'P0 folds', '[flop] P1 bets 80', 'P2 calls'],
    shown: [
      { seat: 1, cards: cards('As Ks') },
      { seat: 2, cards: cards('9c 9d') },
    ],
    results: [
      { seat: 0, delta: -10 },
      { seat: 1, delta: -140 },
      { seat: 2, delta: 150 },
    ],
  };
}

// A mock model whose reflection reply is a fixed players[] payload (the JSON generateText
// reads through Output.object).
function mockReflect(players: { player: string; notes: string[] }[]): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doGenerate: async () =>
      ({
        content: [{ type: 'text', text: JSON.stringify({ players }) }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
        warnings: [],
      }) as unknown as Awaited<ReturnType<MockLanguageModelV3['doGenerate']>>,
  });
}

const throwingModel = (): MockLanguageModelV3 =>
  new MockLanguageModelV3({
    doGenerate: async () => {
      throw new Error('provider exploded');
    },
  });

test('buildHandDigest maps seat tokens to labels and only shows public info', () => {
  const digest = buildHandDigest(sampleRecord(), labelOf);
  // Positions + action log are named, not "P1"/"P2".
  assert.match(digest, /Button: the human\. Small blind: claude-opus-4\.8, big blind: gpt-5\.4\./);
  assert.match(digest, /claude-opus-4\.8 raises to 60/);
  assert.match(digest, /the human folds/);
  assert.ok(!/\bP0\b|\bP1\b|\bP2\b/.test(digest), 'no raw seat tokens leak through');
  // Showdown + results.
  assert.match(digest, /Showdown:/);
  assert.match(digest, /claude-opus-4\.8 showed As Ks/);
  assert.match(digest, /gpt-5\.4 \+150/);
});

test('uncontested pot reports no showdown', () => {
  const rec = sampleRecord();
  rec.shown = [];
  const digest = buildHandDigest(rec, labelOf);
  assert.match(digest, /Showdown: none \(pot uncontested\)\./);
});

test('reflect stores notes, mapping player names back to seats', async () => {
  const mem = new PokerMemory();
  await mem.reflect({
    model: mockReflect([
      { player: 'the human', notes: ['Folds too much preflop.'] },
      { player: 'gpt-5.4', notes: ['Calls raises light, chases draws.'] },
    ]),
    observer: 1,
    subjects: [0, 2],
    record: sampleRecord(),
    labelOf,
  });
  assert.deepEqual(mem.get(1, 0), ['Folds too much preflop.']);
  assert.deepEqual(mem.get(1, 2), ['Calls raises light, chases draws.']);
});

test('reflect caps notes per player at MAX_NOTES and trims blanks', async () => {
  const mem = new PokerMemory();
  await mem.reflect({
    model: mockReflect([{ player: 'gpt-5.4', notes: ['one', '  ', 'two', 'three', 'four', 'five'] }]),
    observer: 1,
    subjects: [2],
    record: sampleRecord(),
    labelOf,
  });
  const notes = mem.get(1, 2);
  assert.equal(notes.length, MAX_NOTES);
  assert.deepEqual(notes, ['one', 'two', 'three']);
});

test('reflect ignores unknown player names', async () => {
  const mem = new PokerMemory();
  await mem.reflect({
    model: mockReflect([{ player: 'nobody-at-this-table', notes: ['ghost read'] }]),
    observer: 1,
    subjects: [0, 2],
    record: sampleRecord(),
    labelOf,
  });
  assert.deepEqual(mem.view(1, [0, 2]), [
    { subject: 0, notes: [] },
    { subject: 2, notes: [] },
  ]);
});

test('reflect leaves notes untouched on model error', async () => {
  const mem = new PokerMemory();
  await mem.reflect({ model: mockReflect([{ player: 'gpt-5.4', notes: ['solid'] }]), observer: 1, subjects: [2], record: sampleRecord(), labelOf });
  await mem.reflect({ model: throwingModel(), observer: 1, subjects: [2], record: sampleRecord(), labelOf });
  assert.deepEqual(mem.get(1, 2), ['solid']);
});

test('renderForPrompt lists only players with notes, keyed by label', () => {
  const mem = new PokerMemory();
  const block = mem.renderForPrompt(1, [0, 2], labelOf);
  assert.equal(block, '', 'empty when no notes yet');
});

test('renderForPrompt renders labelled reads once present', async () => {
  const mem = new PokerMemory();
  await mem.reflect({
    model: mockReflect([{ player: 'gpt-5.4', notes: ['Shoves every hand.'] }]),
    observer: 1,
    subjects: [0, 2],
    record: sampleRecord(),
    labelOf,
  });
  const block = mem.renderForPrompt(1, [0, 2], labelOf);
  assert.match(block, /Your private reads on the other players:/);
  assert.match(block, /- gpt-5\.4: Shoves every hand\./);
  assert.ok(!/the human/.test(block), 'players with no notes are omitted');
});

test('clearObserver drops that seat’s own notes but not others’ notes about it', async () => {
  const mem = new PokerMemory();
  await mem.reflect({ model: mockReflect([{ player: 'gpt-5.4', notes: ['aggro'] }]), observer: 1, subjects: [2], record: sampleRecord(), labelOf });
  await mem.reflect({ model: mockReflect([{ player: 'claude-opus-4.8', notes: ['tight'] }]), observer: 2, subjects: [1], record: sampleRecord(), labelOf });
  mem.clearObserver(1);
  assert.deepEqual(mem.get(1, 2), [], 'seat 1 lost its own notebook');
  assert.deepEqual(mem.get(2, 1), ['tight'], 'seat 2’s read on seat 1 survives');
});
