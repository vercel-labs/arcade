import type { Card } from '../../rules/poker/cards.ts';
import { POKER_CARD_LIFT, POKER_DEAL_HOP, POKER_DECK_POSITION, POKER_DECK_THICKNESS, pokerHoleCardPose } from './layout.ts';

export const POKER_MUCK_POSITION = { x: 1.7, z: POKER_DECK_POSITION.z } as const;
export const POKER_MUCK_STEP = 0.42;
export const POKER_MUCK_HOP = 0.28;
export const POKER_MUCK_JITTER_POSITION = 0.16;
export const POKER_MUCK_JITTER_YAW = 0.34;
export const POKER_MUCK_STACK = 0.014;
export const POKER_GATHER_STEP = 0.5;
export const POKER_GATHER_STAGGER = 0.05;

export interface PokerMuckCard {
  card: Card;
  fromX: number;
  fromZ: number;
  fromYaw: number;
  toX: number;
  toZ: number;
  yaw: number;
  lift: number;
  t: number;
}

export interface PokerGatherCard {
  card: Card;
  fromX: number;
  fromZ: number;
  fromYaw: number;
  faceUp: boolean;
  delay: number;
}

export interface PokerCardPose { x: number; y: number; z: number; yaw: number; rx?: number }

/** Exact production fold plan: seat cards slide into a seeded loose burn pile. */
export function createPokerMuckCards(cards: readonly Card[], seat: number, seatCount: number, startIndex: number, rng: () => number): PokerMuckCard[] {
  return cards.map((card, round) => {
    const from = pokerHoleCardPose(seat, round, seatCount);
    const index = startIndex + round;
    return {
      card, fromX: from.x, fromZ: from.z, fromYaw: from.yaw,
      toX: POKER_MUCK_POSITION.x + (rng() * 2 - 1) * POKER_MUCK_JITTER_POSITION,
      toZ: POKER_MUCK_POSITION.z + (rng() * 2 - 1) * POKER_MUCK_JITTER_POSITION,
      yaw: (rng() * 2 - 1) * POKER_MUCK_JITTER_YAW,
      lift: POKER_CARD_LIFT + index * POKER_MUCK_STACK,
      t: 0,
    };
  });
}

export function pokerMuckCardPose(card: PokerMuckCard, progress = card.t): PokerCardPose {
  const p = smooth(progress);
  return {
    x: lerp(card.fromX, card.toX, p),
    y: card.lift + Math.sin(p * Math.PI) * POKER_MUCK_HOP,
    z: lerp(card.fromZ, card.toZ, p),
    yaw: card.fromYaw + wrapPi(card.yaw - card.fromYaw) * p,
  };
}

export function createPokerGatherCard(card: Card, fromX: number, fromZ: number, fromYaw: number, faceUp: boolean, index: number): PokerGatherCard {
  return { card, fromX, fromZ, fromYaw, faceUp, delay: index * POKER_GATHER_STAGGER };
}

/** Exact production end-of-hand sweep into the growing live deck. */
export function pokerGatherCardPose(card: PokerGatherCard, index: number, elapsed: number, deckBaseTopY: number): PokerCardPose {
  const p = smooth((elapsed - card.delay) / POKER_GATHER_STEP);
  const landY = deckBaseTopY + index * POKER_DECK_THICKNESS;
  const rx0 = card.faceUp ? -Math.PI / 2 : Math.PI / 2;
  return {
    x: lerp(card.fromX, POKER_DECK_POSITION.x, p),
    y: lerp(POKER_CARD_LIFT, landY, p) + Math.sin(p * Math.PI) * POKER_DEAL_HOP * 0.6,
    z: lerp(card.fromZ, POKER_DECK_POSITION.z, p),
    yaw: card.fromYaw + wrapPi(-card.fromYaw) * p,
    rx: lerp(rx0, Math.PI / 2, p),
  };
}

export function pokerGatherDuration(cardCount: number): number {
  return (Math.max(0, cardCount - 1) * POKER_GATHER_STAGGER) + POKER_GATHER_STEP;
}

function wrapPi(angle: number): number { return ((angle + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; }
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function smooth(value: number): number { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); }
