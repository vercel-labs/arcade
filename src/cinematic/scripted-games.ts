/** Anderssen–Dufresne, 1852 (the Evergreen Game), ending in mate. */
import { POKER_MUCK_STEP } from '../game-visuals/poker/card-collection.ts';

export const EVERGREEN_GAME_MOVES = [
  'e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'b4', 'Bxb4', 'c3', 'Ba5',
  'd4', 'exd4', 'O-O', 'd3', 'Qb3', 'Qf6', 'e5', 'Qg6', 'Re1', 'Nge7',
  'Ba3', 'b5', 'Qxb5', 'Rb8', 'Qa4', 'Bb6', 'Nbd2', 'Bb7', 'Ne4', 'Qf5',
  'Bxd3', 'Qh5', 'Nf6+', 'gxf6', 'exf6', 'Rg8', 'Rad1', 'Qxf3', 'Rxe7+',
  'Nxe7', 'Qxd7+', 'Kxd7', 'Bf5+', 'Ke8', 'Bd7+', 'Kf8', 'Bxe7#',
] as const;

export const CHESS_MOVE_SECONDS = 0.46;
export const CHESS_LOOP_HOLD_SECONDS = 1.6;
export const CHESS_LOOP_SECONDS = EVERGREEN_GAME_MOVES.length * CHESS_MOVE_SECONDS + CHESS_LOOP_HOLD_SECONDS;

// Two production DeckShuffle cycles take 2 * 4.5 / SHUFFLE_SPEED(1.5) = 6s.
// The original cinematic compressed them into 2.52s; extend the loop and shift
// every later beat so shuffle playback matches the real Poker game exactly.
export const POKER_LOOP_SECONDS = 21.48;
const POKER_SHUFFLE_SECONDS = 6;
const POKER_SHUFFLE_EXTENSION = POKER_SHUFFLE_SECONDS - 18 * 0.14;
const shifted = (originalPhase: number): number => (originalPhase * 18 + POKER_SHUFFLE_EXTENSION) / POKER_LOOP_SECONDS;

export interface PokerLoopState {
  shuffle: number;
  deckTurn: number;
  deal: number;
  peek: number;
  seatPeeks: readonly (readonly [number, number])[];
  flop: number;
  turn: number;
  river: number;
  foldedSeats: readonly number[];
  folds: readonly PokerScriptedFold[];
  bets: readonly PokerScriptedBet[];
  collect: number;
  showdown: number;
  award: number;
  gatherElapsed: number | null;
}

export interface PokerScriptedBet { seat: number; amount: number; travel: number }
export interface PokerScriptedFold { seat: number; progress: number }

/** One deterministic table hand, expressed as production-renderer control values. */
export function pokerLoopState(phase: number): PokerLoopState {
  const p = clamp01(phase);
  return {
    shuffle: range(p, 0, POKER_SHUFFLE_SECONDS / POKER_LOOP_SECONDS),
    deckTurn: smooth(range(p, shifted(0.14), shifted(0.18))),
    deal: range(p, shifted(0.18), shifted(0.38)),
    peek: smooth(range(p, shifted(0.34), shifted(0.45))),
    seatPeeks: [
      // xAI: a quick staggered look at both cards.
      [peekPulse(p, shifted(0.315), shifted(0.39), 0.45), peekPulse(p, shifted(0.335), shifted(0.41), 0.45)],
      // OpenAI: checks only the first card.
      [peekPulse(p, shifted(0.355), shifted(0.42), 0.45), 0],
      // Anthropic: lifts the second card fully face-on, then checks the first.
      [peekPulse(p, shifted(0.395), shifted(0.47), 0.45), peekPulse(p, shifted(0.35), shifted(0.455), 1)],
      // Google: two short, slightly out-of-order peeks before folding later.
      [peekPulse(p, shifted(0.38), shifted(0.435), 0.45), peekPulse(p, shifted(0.365), shifted(0.425), 0.45)],
      // DeepSeek: one deliberate two-card look held a touch longer.
      [peekPulse(p, shifted(0.37), shifted(0.47), 0.45), peekPulse(p, shifted(0.385), shifted(0.485), 0.45)],
    ],
    flop: smooth(range(p, shifted(0.4), shifted(0.5))),
    turn: smooth(range(p, shifted(0.58), shifted(0.63))),
    river: smooth(range(p, shifted(0.69), shifted(0.74))),
    foldedSeats: p >= shifted(0.65) ? [3, 1] : p >= shifted(0.52) ? [3] : [],
    folds: [scriptedFold(p, 3, shifted(0.52)), scriptedFold(p, 1, shifted(0.65))].filter((fold): fold is PokerScriptedFold => fold !== null),
    bets: [
      scriptedBet(p, 2, 120, shifted(0.38)),
      scriptedBet(p, 4, 120, shifted(0.405)),
      scriptedBet(p, 0, 240, shifted(0.43)),
    ].filter((bet): bet is PokerScriptedBet => bet !== null),
    collect: smooth(range(p, shifted(0.5), shifted(0.535))),
    showdown: smooth(range(p, shifted(0.78), shifted(0.84))),
    award: smooth(range(p, shifted(0.825), shifted(0.855))),
    gatherElapsed: p < shifted(0.86) ? null : range(p, shifted(0.86), shifted(0.98)) * (18 * 0.12),
  };
}

function peekPulse(phase: number, from: number, to: number, peak: number): number {
  if (phase <= from || phase >= to) return 0;
  const t = (phase - from) / (to - from);
  return peak * smooth(1 - Math.abs(t * 2 - 1));
}

function scriptedBet(phase: number, seat: number, amount: number, start: number): PokerScriptedBet | null {
  if (phase < start) return null;
  return { seat, amount, travel: smooth(range(phase, start, start + 0.025)) };
}
function scriptedFold(phase: number, seat: number, start: number): PokerScriptedFold | null {
  if (phase < start) return null;
  return { seat, progress: smooth(range(phase, start, start + POKER_MUCK_STEP / POKER_LOOP_SECONDS)) };
}


function range(value: number, from: number, to: number): number { return clamp01((value - from) / (to - from)); }
function smooth(value: number): number { return value * value * (3 - 2 * value); }
function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
