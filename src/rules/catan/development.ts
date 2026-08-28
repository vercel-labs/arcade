import { DEV_CARD_COUNTS, DEV_CARD_TYPES, type DevCardType } from './types.ts';

/** Build and shuffle the official 25-card base-game development deck. */
export function buildDevelopmentDeck(rng: () => number): DevCardType[] {
  const deck: DevCardType[] = [];
  for (const type of DEV_CARD_TYPES) {
    for (let i = 0; i < DEV_CARD_COUNTS[type]; i++) deck.push(type);
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
