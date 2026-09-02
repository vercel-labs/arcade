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
const POKER_FIRST_SHUFFLE_SECONDS = 3;
const shifted = (originalPhase: number, shuffleSeconds = POKER_SHUFFLE_SECONDS): number =>
  (originalPhase * 18 + shuffleSeconds - 18 * 0.14) / POKER_LOOP_SECONDS;

export interface PokerLoopState {
  handIndex: number;
  winnerSeat: number;
  shuffle: number;
  shuffleCycles: 1 | 2;
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

export interface PokerCinematicHand {
  board: readonly [string, string, string, string, string];
  seats: readonly [readonly [string, string], readonly [string, string], readonly [string, string], readonly [string, string], readonly [string, string]];
  winnerSeat: number;
  foldSeats: readonly number[];
  bets: readonly { seat: number; amount: number; start: number }[];
}

export const POKER_CINEMATIC_HANDS: readonly PokerCinematicHand[] = [
  {
    board: ['10h', '7c', '2d', 'Jc', 'Qh'],
    seats: [['As', 'Kh'], ['8c', '8d'], ['Qs', 'Jh'], ['5d', '4d'], ['Ac', '9s']],
    winnerSeat: 0,
    foldSeats: [3, 1],
    bets: [{ seat: 2, amount: 120, start: 0.38 }, { seat: 4, amount: 120, start: 0.405 }, { seat: 0, amount: 240, start: 0.43 }],
  },
  {
    board: ['9h', '9c', '2s', 'Kd', '4c'],
    seats: [['As', 'Qd'], ['Jh', '10h'], ['Kh', 'Ks'], ['9s', '8s'], ['Ac', '5d']],
    winnerSeat: 2,
    foldSeats: [4, 0],
    bets: [{ seat: 1, amount: 80, start: 0.375 }, { seat: 3, amount: 160, start: 0.41 }, { seat: 2, amount: 320, start: 0.445 }],
  },
  {
    board: ['2h', '5h', '8h', 'Jc', 'Qs'],
    seats: [['Ad', 'Qc'], ['10s', '10d'], ['Js', '9c'], ['8c', '7d'], ['Ah', 'Kh']],
    winnerSeat: 4,
    foldSeats: [1],
    bets: [{ seat: 0, amount: 100, start: 0.37 }, { seat: 2, amount: 100, start: 0.395 }, { seat: 3, amount: 200, start: 0.425 }, { seat: 4, amount: 400, start: 0.455 }],
  },
] as const;

/** One deterministic table hand, expressed as production-renderer control values. */
export function pokerLoopState(phase: number, handIndex = 0): PokerLoopState {
  const p = clamp01(phase);
  const shuffleSeconds = handIndex === 0 ? POKER_FIRST_SHUFFLE_SECONDS : POKER_SHUFFLE_SECONDS;
  const shift = (originalPhase: number): number => shifted(originalPhase, shuffleSeconds);
  const resolvedHandIndex = Math.abs(Math.trunc(handIndex)) % POKER_CINEMATIC_HANDS.length;
  const script = POKER_CINEMATIC_HANDS[resolvedHandIndex];
  const foldStarts = script.foldSeats.map((_, index) => 0.52 + index * 0.13);
  return {
    handIndex: resolvedHandIndex,
    winnerSeat: script.winnerSeat,
    shuffle: range(p, 0, shuffleSeconds / POKER_LOOP_SECONDS),
    shuffleCycles: handIndex === 0 ? 1 : 2,
    deckTurn: smooth(range(p, shift(0.14), shift(0.18))),
    deal: range(p, shift(0.18), shift(0.38)),
    peek: smooth(range(p, shift(0.34), shift(0.45))),
    seatPeeks: pokerSeatPeeks(p, resolvedHandIndex, shift),
    flop: smooth(range(p, shift(0.4), shift(0.5))),
    turn: smooth(range(p, shift(0.58), shift(0.63))),
    river: smooth(range(p, shift(0.69), shift(0.74))),
    foldedSeats: script.foldSeats.filter((_, index) => p >= shift(foldStarts[index])),
    folds: script.foldSeats.map((seat, index) => scriptedFold(p, seat, shift(foldStarts[index]))).filter((fold): fold is PokerScriptedFold => fold !== null),
    bets: script.bets.map((bet) => scriptedBet(p, bet.seat, bet.amount, shift(bet.start))).filter((bet): bet is PokerScriptedBet => bet !== null),
    collect: smooth(range(p, shift(0.5), shift(0.535))),
    showdown: smooth(range(p, shift(0.78), shift(0.84))),
    award: smooth(range(p, shift(0.825), shift(0.855))),
    gatherElapsed: p < shift(0.86) ? null : range(p, shift(0.86), shift(0.98)) * (18 * 0.12),
  };
}

function pokerSeatPeeks(p: number, handIndex: number, shift: (originalPhase: number) => number): readonly (readonly [number, number])[] {
  const profiles = [
    [[0.315, 0.39, 0.45], [0.335, 0.41, 0.45], [0.355, 0.42, 0.45], null, [0.395, 0.47, 0.45], [0.35, 0.455, 1], [0.38, 0.435, 0.45], [0.365, 0.425, 0.45], [0.37, 0.47, 0.45], [0.385, 0.485, 0.45]],
    [[0.39, 0.47, 0.55], null, [0.32, 0.405, 0.45], [0.345, 0.43, 0.45], [0.36, 0.455, 0.7], [0.375, 0.47, 0.7], [0.335, 0.4, 0.45], null, [0.405, 0.48, 0.45], [0.385, 0.46, 0.45]],
    [[0.34, 0.41, 0.45], [0.37, 0.44, 0.45], [0.405, 0.47, 0.45], null, [0.325, 0.41, 0.6], [0.35, 0.44, 0.6], [0.38, 0.46, 0.45], [0.355, 0.425, 0.45], [0.31, 0.43, 1], [0.33, 0.45, 1]],
  ] as const;
  const profile = profiles[handIndex];
  return Array.from({ length: 5 }, (_, seat) => [peekFromProfile(p, profile[seat * 2], shift), peekFromProfile(p, profile[seat * 2 + 1], shift)] as const);
}

function peekFromProfile(p: number, profile: readonly [number, number, number] | null, shift: (originalPhase: number) => number): number {
  return profile ? peekPulse(p, shift(profile[0]), shift(profile[1]), profile[2]) : 0;
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
