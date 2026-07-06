import { test } from 'node:test';
import assert from 'node:assert/strict';
import { type Card, fullDeck, parseCard, shuffle } from './cards.ts';
import {
  CATEGORY_NAMES,
  evaluate,
  FLUSH,
  FULL_HOUSE,
  HIGH_CARD,
  PAIR,
  QUADS,
  STRAIGHT,
  STRAIGHT_FLUSH,
  TRIPS,
  TWO_PAIR,
} from './hand-eval.ts';

// Parse a space-separated hand string ("Ah Kh Qh Jh Th") into Cards.
function hand(s: string): Card[] {
  return s.split(/\s+/).map((c) => {
    const card = parseCard(c);
    if (!card) throw new Error(`bad card "${c}"`);
    return card;
  });
}

const cat = (s: string): number => evaluate(hand(s)).category;
const val = (s: string): number => evaluate(hand(s)).value;

test('categories are detected', () => {
  assert.equal(cat('Ah Kh Qh Jh Th'), STRAIGHT_FLUSH);
  assert.equal(cat('As Ah Ad Ac Kh'), QUADS);
  assert.equal(cat('As Ah Ad Kc Kh'), FULL_HOUSE);
  assert.equal(cat('Ah 9h 7h 4h 2h'), FLUSH);
  assert.equal(cat('9s 8h 7d 6c 5h'), STRAIGHT);
  assert.equal(cat('As Ah Ad Qc Kh'), TRIPS);
  assert.equal(cat('As Ah Kd Kc Qh'), TWO_PAIR);
  assert.equal(cat('As Ah Kd Qc Jh'), PAIR);
  assert.equal(cat('As Kh Qd Jc 9h'), HIGH_CARD);
});

test('the wheel is a 5-high straight, not Ace-high', () => {
  assert.equal(cat('As 2h 3d 4c 5h'), STRAIGHT);
  // 6-high straight beats the wheel.
  assert.ok(val('6s 5h 4d 3c 2h') > val('As 2h 3d 4c 5h'));
  // Broadway is the best straight.
  assert.ok(val('Ah Kd Qc Js Th') > val('Ks Qh Jd Tc 9h'));
});

test('wheel straight flush ranks below other straight flushes', () => {
  assert.equal(cat('As 2s 3s 4s 5s'), STRAIGHT_FLUSH);
  assert.ok(val('6s 5s 4s 3s 2s') > val('As 2s 3s 4s 5s'));
});

test('kickers break ties correctly', () => {
  // Same pair of Kings, Ace kicker beats Ten kicker.
  assert.ok(val('Ks Kh Ad Qc Jh') > val('Ks Kh Td Qc Jh'));
  // Two pair: kicker decides.
  assert.ok(val('Ks Kh Qd Qc Ah') > val('Ks Kh Qd Qc Jh'));
  // Full house: trips rank dominates the pair rank.
  assert.ok(val('Ks Kh Kd 2c 2h') > val('Qs Qh Qd Ac Ah'));
});

test('category ordering holds', () => {
  assert.ok(val('2h 2d 3c 4s 5h') > val('Ah Kd Qc Js 9h')); // pair > high card
  assert.ok(val('9s 8h 7d 6c 5h') > val('As Ah Kd Qc Jh')); // straight > pair
  assert.ok(val('Ah 9h 7h 4h 2h') > val('9s 8h 7d 6c 5h')); // flush > straight
  assert.ok(val('As Ah Ad Kc Kh') > val('Ah 9h 7h 4h 2h')); // full house > flush
  assert.ok(val('As Ah Ad Ac Kh') > val('As Ah Ad Kc Kh')); // quads > full house
});

test('best 5-of-7 is chosen, not the first five', () => {
  // Seven cards: two black aces + three hearts that with the two hearts make a
  // flush — but the pair of aces + a flush → the flush wins, and evaluate must
  // find it across all seven.
  const v = evaluate(hand('As Ac Kh Qh Jh 9h 2h'));
  assert.equal(v.category, FLUSH);
  // A made straight hidden in 7 cards.
  assert.equal(evaluate(hand('9s 8h 7d 6c 5h 2s 2d')).category, STRAIGHT);
});

// ── Cross-check the direct evaluator against a brute-force 5-of-7 subset search ──

function combinations5(cards: Card[]): Card[][] {
  const out: Card[][] = [];
  const n = cards.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++) out.push([cards[a], cards[b], cards[c], cards[d], cards[e]]);
  return out;
}

// The brute-force reference: the max `evaluate` over all 5-card subsets. `evaluate`
// on exactly 5 cards is the ground truth we trust; the direct 7-card path must
// match the best subset.
function bruteForce(cards: Card[]): number {
  let best = -1;
  for (const combo of combinations5(cards)) best = Math.max(best, evaluate(combo).value);
  return best;
}

test('direct 7-card evaluation matches brute-force best-of-21 (random batches)', () => {
  const rng = (() => {
    let a = 0x1234abcd;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let x = Math.imul(a ^ (a >>> 15), 1 | a);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  })();
  for (let trial = 0; trial < 2000; trial++) {
    const deck = shuffle(fullDeck(), rng);
    const seven = deck.slice(0, 7);
    assert.equal(evaluate(seven).value, bruteForce(seven), `mismatch on ${seven.map((c) => c.rank + ':' + c.suit).join(' ')}`);
  }
});

test('ties produce equal values (split pots)', () => {
  // Same board, both play the board → identical value.
  assert.equal(val('Ah Kh Qh Jh Th'), val('Ah Kh Qh Jh Th'));
  // Different suits, same ranks → equal (suits are not ranked).
  assert.equal(val('As Ks Qh Jd 9c'), val('Ad Kd Qs Jh 9h'));
});

test('CATEGORY_NAMES covers every category', () => {
  assert.equal(CATEGORY_NAMES.length, 9);
});
