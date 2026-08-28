import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TERMINAL } from '../game.ts';
import { HoldemState, type PokerAction } from './holdem.ts';

// Deterministic RNG so deals are reproducible (never actually inspected — these
// tests drive the betting machine, whose logic is card-independent).
function rng(seed = 0x1234): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function heads(stacks = [1000, 1000], button = 0): HoldemState {
  return new HoldemState({ stacks, button, smallBlind: 10, bigBlind: 20, rng: rng() });
}

test('heads-up: button is the small blind and acts first preflop', () => {
  const s = heads([1000, 1000], 0);
  // Button (0) posts SB 10, seat 1 posts BB 20.
  assert.equal(s.stackOf(0), 990);
  assert.equal(s.stackOf(1), 980);
  assert.equal(s.toActSeat(), 0); // button acts first preflop heads-up
});

test('heads-up: BB acts first postflop', () => {
  const s = heads([1000, 1000], 0);
  s.applyAction({ type: 'call' }); // button limps to 20
  s.applyAction({ type: 'check' }); // BB checks its option → flop
  assert.equal(s.street(), 1); // flop
  assert.equal(s.toActSeat(), 1); // BB (seat 1) acts first postflop
});

test('3-handed: SB left of button, UTG acts first preflop, SB first postflop', () => {
  const s = new HoldemState({ stacks: [1000, 1000, 1000], button: 0, smallBlind: 10, bigBlind: 20, rng: rng() });
  assert.equal(s.stackOf(1), 990); // seat 1 = SB
  assert.equal(s.stackOf(2), 980); // seat 2 = BB
  assert.equal(s.toActSeat(), 0); // seat 0 = UTG (left of BB), acts first preflop
  s.applyAction({ type: 'call' }); // UTG calls
  s.applyAction({ type: 'call' }); // SB completes
  s.applyAction({ type: 'check' }); // BB checks option → flop
  assert.equal(s.street(), 1);
  assert.equal(s.toActSeat(), 1); // SB (first active left of button) acts first postflop
});

test('fold to one leaves the hand uncontested, no showdown, zero-sum returns', () => {
  const s = heads([1000, 1000], 0);
  s.applyAction({ type: 'fold' }); // button folds preflop
  assert.ok(s.isTerminal());
  assert.equal(s.currentPlayer(), TERMINAL);
  assert.equal(s.showdownSeats().length, 0); // no showdown
  const r = s.returns();
  assert.equal(r[0] + r[1], 0);
  assert.equal(r[0], -10); // button loses its SB
  assert.equal(r[1], 10); // BB wins it
});

test('check-down to showdown deals a full board and pays a winner', () => {
  const s = heads([1000, 1000], 0);
  s.applyAction({ type: 'call' }); // preflop
  s.applyAction({ type: 'check' });
  for (let street = 0; street < 3; street++) {
    // flop, turn, river: both check
    s.applyAction({ type: 'check' });
    s.applyAction({ type: 'check' });
  }
  assert.ok(s.isTerminal());
  assert.equal(s.boardCards().length, 5);
  assert.equal(s.showdownSeats().length, 2);
  const r = s.returns();
  assert.equal(r[0] + r[1], 0);
});

test('legalActions is finite, always includes fold, and excludes below-min raises', () => {
  const s = heads([1000, 1000], 0);
  const acts = s.legalActions();
  assert.ok(acts.some((a) => a.type === 'fold'));
  assert.ok(acts.some((a) => a.type === 'call')); // button faces the BB
  // A raise below the minimum (to 25, min is 40 = 20 + 20) must not appear.
  const raises = acts.filter((a): a is Extract<PokerAction, { type: 'raise' }> => a.type === 'raise');
  assert.ok(raises.every((r) => r.to >= 40));
  assert.ok(acts.length <= 6); // finite, small menu
});

test('applyAction clamps a below-min raise up to the legal minimum', () => {
  const s = heads([1000, 1000], 0);
  s.applyAction({ type: 'raise', to: 25 }); // below min-raise (40); clamps to 40
  assert.equal(s.currentBetAmount(), 40);
  const recorded = s.appliedActionHistory()[0];
  assert.deepEqual(recorded.requested, { type: 'raise', to: 25 });
  assert.equal(recorded.effective.type, 'raise');
  assert.equal(recorded.effective.streetCommitmentAfter, 40);
  assert.equal(recorded.adjusted, true);
});

test('structured action ledger records normalization without model text', () => {
  const s = heads([1000, 1000], 0);
  s.applyAction({ type: 'check' }); // facing the BB: normalized to a call
  const [a] = s.appliedActionHistory();
  assert.deepEqual(a.requested, { type: 'check' });
  assert.equal(a.effective.type, 'call');
  assert.equal(a.effective.amountCommitted, 10);
  assert.equal(a.adjusted, true);
  assert.equal(a.potBefore, 30);
  assert.equal(a.potAfter, 40);
});

test('a short all-in does not raise the min-raise floor for the next raiser', () => {
  // Seat 2 is short: it can only shove ~30 total, which is less than a full raise
  // over a 20 bet → does not reopen a full raise requirement.
  const s = new HoldemState({ stacks: [1000, 1000, 30], button: 0, smallBlind: 10, bigBlind: 20, rng: rng() });
  // toAct = UTG (seat 0). Seat 0 raises to 60 (full raise, min becomes 40).
  s.applyAction({ type: 'raise', to: 60 });
  // Seat 1 calls 60.
  s.applyAction({ type: 'call' });
  // Seat 2 (BB) shoves all-in for 30 total < 60 → a short all-in call, not a raise.
  assert.equal(s.toActSeat(), 2);
  s.applyAction({ type: 'allin' });
  assert.ok(s.isAllIn(2));
  // No reopening: seats 0 and 1 (already matched at 60) do NOT act again, so the
  // preflop round closes and we advance to the flop rather than looping back.
  assert.equal(s.street(), 1);
});

test('side pots: 3-way all-in splits correctly (the worked example)', () => {
  // Stacks 50 / 200 / 200. Seat 1 = SB(10), seat 2 = BB(20), seat 0 = UTG.
  // We want committedHand = [50, 200, 200] with nobody folding.
  const s = new HoldemState({ stacks: [50, 200, 200], button: 0, smallBlind: 10, bigBlind: 20, rng: rng() });
  // UTG (seat 0) shoves 50.
  s.applyAction({ type: 'allin' }); // seat 0 all-in 50
  // SB (seat 1) raises to 200 (all-in).
  s.applyAction({ type: 'allin' }); // seat 1 all-in 200
  // BB (seat 2) calls 200 (all-in).
  s.applyAction({ type: 'allin' }); // seat 2 all-in 200
  assert.ok(s.isTerminal(), 'all three all-in → board runs out to showdown');
  const r = s.returns();
  assert.equal(r[0] + r[1] + r[2], 0, 'zero-sum');
  // Total chips conserved.
  assert.equal(50 + 200 + 200, s.potTotal());
  const awards = s.canonicalRecord().awards;
  assert.equal(awards.reduce((sum, award) => sum + award.amount, 0), 450);
  assert.deepEqual([...new Set(awards.map((award) => award.potIndex))], [0, 1]);
});

test('returns() is zero-sum across many random all-AI hands (never deadlocks / never CHANCE)', () => {
  const g = rng(0xbeef);
  for (let hand = 0; hand < 300; hand++) {
    const n = 2 + Math.floor(g() * 5); // 2..6 players
    const stacks = Array.from({ length: n }, () => 40 + Math.floor(g() * 400));
    const s = new HoldemState({ stacks, button: hand % n, smallBlind: 10, bigBlind: 20, rng: rng((hand * 2654435761) >>> 0) });
    let guard = 0;
    while (!s.isTerminal()) {
      const p = s.currentPlayer();
      assert.ok(p >= 0 && p < n, `currentPlayer ${p} must be a real seat, never CHANCE/terminal mid-hand`);
      assert.ok(!s.isFolded(p) && !s.isAllIn(p), 'the seat to act is never folded or all-in');
      const acts = s.legalActions();
      assert.ok(acts.length > 0, 'a non-terminal state has legal actions');
      // Pick a random legal action.
      s.applyAction(acts[Math.floor(g() * acts.length)]);
      assert.ok(++guard < 1000, 'no infinite loop');
    }
    const r = s.returns();
    const sum = r.reduce((a, b) => a + b, 0);
    assert.equal(sum, 0, `hand ${hand}: returns must sum to zero`);
    // Chips conserved: every seat's final delta ≥ −startingStack.
    for (let i = 0; i < n; i++) assert.ok(r[i] >= -stacks[i] - 1, `seat ${i} cannot lose more than its stack`);
  }
});

test('a busted (0-chip) seat sits out: folded from the start, no blind, skipped', () => {
  // Seat 1 is busted. Among seats 0 and 2 the hand plays heads-up.
  const s = new HoldemState({ stacks: [1000, 0, 1000], button: 0, smallBlind: 10, bigBlind: 20, rng: rng() });
  assert.ok(s.isFolded(1)); // out from the start
  assert.equal(s.holeOf(1).length, 0); // dealt no cards
  assert.equal(s.stackOf(1), 0);
  // Heads-up among the two in-seats: button (0) is SB, seat 2 is BB.
  assert.equal(s.stackOf(0), 990);
  assert.equal(s.stackOf(2), 980);
  assert.equal(s.toActSeat(), 0); // button acts first (heads-up rule among in-seats)
  s.applyAction({ type: 'fold' });
  assert.ok(s.isTerminal());
  const r = s.returns();
  assert.equal(r[1], 0); // the sitting-out seat neither wins nor loses
  assert.equal(r[0] + r[1] + r[2], 0);
});

test('clone() is independent', () => {
  const s = heads([1000, 1000], 0);
  const c = s.clone();
  s.applyAction({ type: 'raise', to: 100 });
  assert.notEqual(s.currentBetAmount(), c.currentBetAmount());
  assert.equal(c.currentBetAmount(), 20); // clone untouched
  assert.equal(c.smallBlindSeat(), 0);
  assert.equal(c.bigBlindSeat(), 1);
});

test('canonical record stores every hole card with public visibility semantics', () => {
  const folded = heads([1000, 1000], 0);
  folded.applyAction({ type: 'fold' });
  const hidden = folded.canonicalRecord();
  assert.equal(hidden.holeCards[0].disposition, 'folded_hidden');
  assert.equal(hidden.holeCards[1].disposition, 'winner_not_shown');
  assert.equal(hidden.holeCards.flatMap((h) => h.cards).length, 4);
  assert.equal(hidden.results.length, 2);
  assert.equal(hidden.results.reduce((sum, r) => sum + r.net, 0), 0);

  const shown = heads([1000, 1000], 0);
  shown.applyAction({ type: 'call' });
  shown.applyAction({ type: 'check' });
  for (let street = 0; street < 3; street++) {
    shown.applyAction({ type: 'check' });
    shown.applyAction({ type: 'check' });
  }
  const showdown = shown.canonicalRecord();
  assert.ok(showdown.holeCards.every((h) => h.disposition === 'shown'));
  assert.deepEqual(showdown.board.map((b) => b.street), ['flop', 'turn', 'river']);
  assert.equal(showdown.board.flatMap((b) => b.cards).length, 5);
  assert.equal(showdown.actions.length, 8);
});

test('an incomplete canonical record rolls unrealized commitments back to carried stacks', () => {
  const s = heads([1000, 1000], 0);
  const record = s.canonicalRecord();
  assert.equal(record.completed, false);
  assert.deepEqual(record.endingStacks, record.startingStacks);
  assert.ok(record.results.some((result) => result.committed > 0)); // posted blinds remain observable
  assert.ok(record.results.every((result) => result.net === 0 && record.endingStacks[result.seat] === record.startingStacks[result.seat]));
});

test('informationStateString never leaks another seat hole card', () => {
  const s = new HoldemState({ stacks: [1000, 1000, 1000], button: 0, smallBlind: 10, bigBlind: 20, rng: rng() });
  const view0 = s.informationStateString(0);
  assert.match(view0, /Blinds: 10\/20/);
  assert.match(view0, /Your stack: \d+ chips \([\d.]+ big blinds\)/);
  // Seat 0's view must contain its own two cards but not both of any other seat's.
  const own = s.holeOf(0).map((c) => `${c.rank}:${c.suit}`);
  for (let other = 1; other < 3; other++) {
    const label = s.holeOf(other).map((c) => c.rank + '/' + c.suit); // internal, not the printed label
    // The printed view lists only labels; assert seat 1/2's card labels aren't both present.
    const labels = s.holeOf(other).map((c) => cardText(c));
    const bothPresent = labels.every((l) => view0.includes(l));
    // It's possible a single label coincidentally matches seat 0's; require NOT both of the other seat's.
    if (labels[0] !== labels[1]) assert.ok(!bothPresent, `seat 0 view leaked seat ${other}'s hole`);
    void own;
    void label;
  }
});

// Local mini card-label (avoid importing to keep the test self-contained-ish).
function cardText(c: { rank: number; suit: number }): string {
  const R = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const S = ['s', 'h', 'd', 'c'];
  return `${R[c.rank]}${S[c.suit]}`;
}

test('actionFromString parses the poker vocabulary', () => {
  const s = heads();
  assert.deepEqual(s.actionFromString('fold'), { type: 'fold' });
  assert.deepEqual(s.actionFromString('CALL'), { type: 'call' });
  assert.deepEqual(s.actionFromString('check'), { type: 'check' });
  assert.deepEqual(s.actionFromString('all-in'), { type: 'allin' });
  assert.deepEqual(s.actionFromString('raise 120'), { type: 'raise', to: 120 });
  assert.deepEqual(s.actionFromString('bet 60'), { type: 'bet', amount: 60 });
  assert.equal(s.actionFromString('banana'), null);
});
