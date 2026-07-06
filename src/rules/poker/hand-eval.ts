// Poker hand evaluation: the best 5-card hand out of 5..7 cards, encoded as a
// single comparable integer (higher = stronger) so showdowns are a number compare
// and ties (split pots) are integer equality. No rules/betting here — just ranking.
//
// Encoding: category in the high nibble, then up to five ordered tiebreak ranks
// (2..14, most significant first), 4 bits each:
//   value = (category << 20) | (r1 << 16) | (r2 << 12) | (r3 << 8) | (r4 << 4) | r5
// so a straight/flush/quads compare correctly against each other and by kicker.
// Ranks are Ace-high (see rankValue), EXCEPT the wheel A-2-3-4-5, whose top card is
// 5 (the lowest straight) — handled explicitly below.

import { type Card, rankValue } from './cards.ts';

// Hand categories, low → high. The evaluated integer sorts by these first.
export const HIGH_CARD = 0;
export const PAIR = 1;
export const TWO_PAIR = 2;
export const TRIPS = 3;
export const STRAIGHT = 4;
export const FLUSH = 5;
export const FULL_HOUSE = 6;
export const QUADS = 7;
export const STRAIGHT_FLUSH = 8;

export const CATEGORY_NAMES = [
  'High Card',
  'Pair',
  'Two Pair',
  'Three of a Kind',
  'Straight',
  'Flush',
  'Full House',
  'Four of a Kind',
  'Straight Flush',
] as const;

export interface HandValue {
  value: number; // comparable integer (higher = better)
  category: number; // one of the constants above
  ranks: number[]; // the ordered tiebreak ranks that built `value` (for display/debug)
}

// Pack a category + its ordered tiebreak ranks into the comparable integer.
function encode(category: number, ranks: number[]): number {
  let v = category;
  for (let i = 0; i < 5; i++) v = (v << 4) | (ranks[i] ?? 0);
  return v;
}

// The high card of the best straight within a set of distinct Ace-high rank
// values, or 0 if none. Adds the wheel (A-2-3-4-5): an Ace also counts as 1, so a
// hand with A,2,3,4,5 makes a 5-high straight.
function straightHigh(distinct: number[]): number {
  const present = new Set(distinct);
  if (present.has(14)) present.add(1); // Ace low for the wheel
  const ranks = [...present].sort((a, b) => b - a);
  let run = 1;
  for (let i = 1; i < ranks.length; i++) {
    if (ranks[i] === ranks[i - 1] - 1) {
      run++;
      if (run >= 5) return ranks[i - 4]; // descending: the top of the 5-run is 4 back
    } else {
      run = 1;
    }
  }
  return 0;
}

// Best 5-of-N (N = 5..7) as a comparable HandValue. Works directly off rank counts
// + suit counts rather than enumerating 5-card subsets.
export function evaluate(cards: Card[]): HandValue {
  // Count by Ace-high rank (2..14) and collect suits.
  const rankCount = new Array(15).fill(0);
  const suitCount = [0, 0, 0, 0];
  const bySuit: number[][] = [[], [], [], []];
  for (const c of cards) {
    const rv = rankValue(c);
    rankCount[rv]++;
    suitCount[c.suit]++;
    bySuit[c.suit].push(rv);
  }
  const distinct: number[] = [];
  for (let r = 14; r >= 2; r--) if (rankCount[r] > 0) distinct.push(r);

  // Flush: the suit with ≥5 cards (at most one can qualify with 7 cards).
  const flushSuit = suitCount.findIndex((n) => n >= 5);

  // Straight flush: a straight among the flush suit's ranks.
  if (flushSuit >= 0) {
    const sfHigh = straightHigh(bySuit[flushSuit]);
    if (sfHigh) return { value: encode(STRAIGHT_FLUSH, [sfHigh]), category: STRAIGHT_FLUSH, ranks: [sfHigh] };
  }

  // Group ranks by count (quads, trips, pairs), each list high → low.
  const quads: number[] = [];
  const trips: number[] = [];
  const pairs: number[] = [];
  for (let r = 14; r >= 2; r--) {
    if (rankCount[r] === 4) quads.push(r);
    else if (rankCount[r] === 3) trips.push(r);
    else if (rankCount[r] === 2) pairs.push(r);
  }
  // Singles high → low, for kickers.
  const kickers = (exclude: number[], n: number): number[] => {
    const out: number[] = [];
    for (const r of distinct) {
      if (exclude.includes(r)) continue;
      out.push(r);
      if (out.length === n) break;
    }
    return out;
  };

  // Four of a kind: quad rank + best kicker.
  if (quads.length) {
    const q = quads[0];
    const k = kickers([q], 1);
    return { value: encode(QUADS, [q, k[0]]), category: QUADS, ranks: [q, ...k] };
  }

  // Full house: best trips + best pair (a second set of trips serves as the pair).
  if (trips.length && (pairs.length || trips.length > 1)) {
    const t = trips[0];
    const p = pairs.length ? pairs[0] : trips[1];
    return { value: encode(FULL_HOUSE, [t, p]), category: FULL_HOUSE, ranks: [t, p] };
  }

  // Flush: the five highest cards of the flush suit.
  if (flushSuit >= 0) {
    const top5 = bySuit[flushSuit].slice().sort((a, b) => b - a).slice(0, 5);
    return { value: encode(FLUSH, top5), category: FLUSH, ranks: top5 };
  }

  // Straight (mixed suits).
  const sHigh = straightHigh(distinct);
  if (sHigh) return { value: encode(STRAIGHT, [sHigh]), category: STRAIGHT, ranks: [sHigh] };

  // Three of a kind: trips + two kickers.
  if (trips.length) {
    const t = trips[0];
    const k = kickers([t], 2);
    return { value: encode(TRIPS, [t, ...k]), category: TRIPS, ranks: [t, ...k] };
  }

  // Two pair: top two pairs + one kicker.
  if (pairs.length >= 2) {
    const [p1, p2] = pairs;
    const k = kickers([p1, p2], 1);
    return { value: encode(TWO_PAIR, [p1, p2, k[0]]), category: TWO_PAIR, ranks: [p1, p2, ...k] };
  }

  // One pair: pair + three kickers.
  if (pairs.length === 1) {
    const p = pairs[0];
    const k = kickers([p], 3);
    return { value: encode(PAIR, [p, ...k]), category: PAIR, ranks: [p, ...k] };
  }

  // High card: five highest.
  const top5 = distinct.slice(0, 5);
  return { value: encode(HIGH_CARD, top5), category: HIGH_CARD, ranks: top5 };
}
