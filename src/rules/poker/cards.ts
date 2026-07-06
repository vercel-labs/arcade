// Pure playing-card primitives — no rendering and no rules yet. Shared by the
// poker presentation (card textures / the cards screen) today and the future
// poker rules engine. Kept in rules/ so it stays app-independent: suits, ranks, a
// 52-card deck, and an injectable-RNG shuffle. Notation is the usual shorthand —
// rank label + suit letter ("As", "Td", "Kh").

export type Suit = 0 | 1 | 2 | 3;
export const SPADES: Suit = 0;
export const HEARTS: Suit = 1;
export const DIAMONDS: Suit = 2;
export const CLUBS: Suit = 3;

// Rank index 0..12, indexing RANK_LABELS (0 = Ace). The order is for display and
// iteration only — no comparison semantics live here until the rules engine does.
export const RANK_LABELS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
export const SUIT_LETTERS = ['s', 'h', 'd', 'c'] as const;
export const SUIT_NAMES = ['Spades', 'Hearts', 'Diamonds', 'Clubs'] as const;

export interface Card {
  rank: number; // 0..12 (indexes RANK_LABELS)
  suit: Suit;
}

// Hearts + diamonds print red; spades + clubs black.
export const isRed = (c: Card): boolean => c.suit === HEARTS || c.suit === DIAMONDS;

// "As", "Td", "Kh" — rank label ("10" for tens) + suit letter.
export const cardLabel = (c: Card): string => `${RANK_LABELS[c.rank]}${SUIT_LETTERS[c.suit]}`;

// The Ace-high comparison value of a rank index, 2..14 (2=deuce … 14=Ace). The
// `rank` index itself has NO ordering semantics (Ace is index 0), so anything that
// compares cards — the poker hand evaluator, straights, kickers — must go through
// this rather than using `rank` directly. The wheel (A-2-3-4-5) treats the Ace as
// 1; that special case lives in the evaluator, not here.
export const rankValue = (c: Card): number => (c.rank === 0 ? 14 : c.rank + 1);

// Parse "As", "Td"/"10d", "Kh" back into a Card (inverse of cardLabel), or null if
// it isn't a valid code. Case-insensitive. Handy for fixed test fixtures.
export function parseCard(s: string): Card | null {
  const m = s.trim().match(/^(10|[a2-9tjqk])([shdc])$/i);
  if (!m) return null;
  const label = m[1].toUpperCase() === 'T' ? '10' : m[1].toUpperCase();
  const rank = RANK_LABELS.indexOf(label as (typeof RANK_LABELS)[number]);
  const suit = SUIT_LETTERS.indexOf(m[2].toLowerCase() as (typeof SUIT_LETTERS)[number]);
  if (rank < 0 || suit < 0) return null;
  return { rank, suit: suit as Suit };
}

// A fresh ordered 52-card deck (suit-major: spades A..K, then hearts, …).
export function fullDeck(): Card[] {
  const deck: Card[] = [];
  for (let suit = 0; suit < 4; suit++) {
    for (let rank = 0; rank < 13; rank++) deck.push({ rank, suit: suit as Suit });
  }
  return deck;
}

// In-place Fisher–Yates with an injected RNG (returns 0..1), so callers own the
// seed (reproducible snapshots) and rules/ pulls in no app-side PRNG. Returns the
// same array for chaining.
export function shuffle<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}
