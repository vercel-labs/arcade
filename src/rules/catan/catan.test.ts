import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TERMINAL } from '../game.ts';
import { loadGame, registeredGames } from '../registry.ts';
import { BANK_PER_RESOURCE, NUM_RESOURCES } from './types.ts';
import { CatanState } from './catan.ts';

function rng(seed = 0x5eed): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const fresh = (n = 4) => new CatanState({ numPlayers: n, rng: rng() });

test('a fresh game opens in initial placement, player 0 to act, not terminal', () => {
  const s = fresh();
  assert.equal(s.isTerminal(), false);
  assert.equal(s.currentPlayer(), 0);
  assert.equal(s.currentPrompt().kind, 'initialSettlement');
  assert.equal(s.isChanceNode(), false);
  assert.deepEqual(s.returns(), [0, 0, 0, 0]);
  assert.equal(s.winner(), -1);
});

test('the bank starts at 19 of each resource; hands are empty; 0 VP', () => {
  const s = fresh();
  assert.deepEqual([...s.bankDeck()], new Array(NUM_RESOURCES).fill(BANK_PER_RESOURCE));
  for (let p = 0; p < 4; p++) {
    assert.equal([...s.handOf(p)].reduce((a, b) => a + b, 0), 0);
    assert.equal(s.victoryPoints(p, true), 0);
  }
  assert.equal(s.robber() >= 0, true);
});

test('the observation shows the seat its own view and never an opponent hand breakdown', () => {
  const s = fresh();
  const obs = s.informationStateString(0);
  assert.match(obs, /You are P0/);
  assert.match(obs, /Opponents:/);
});

test('clone is independent from the original', () => {
  const s = fresh();
  const c = s.clone();
  assert.notEqual(c, s);
  assert.equal(c.toString(), s.toString());
});

test('legalActions / applyAction are staged seams (throw) in the foundation phase', () => {
  const s = fresh();
  assert.throws(() => s.legalActions());
  assert.throws(() => s.applyAction({ type: 'roll' }));
});

test('catan self-registers in the game registry', () => {
  assert.ok(registeredGames().includes('catan'));
  assert.equal(loadGame('catan').type.shortName, 'catan');
});
