export interface PokerBlinds {
  smallBlind: number;
  bigBlind: number;
}

export interface PokerBlindStructure {
  initialSmallBlind?: number;
  initialBigBlind?: number;
  handsPerLevel?: number;
  levels?: readonly PokerBlinds[];
}

export interface PokerBlindState extends PokerBlinds {
  /** One-based tournament level and hand number. */
  level: number;
  hand: number;
  completedHands: number;
  handsPerLevel: number;
  handsUntilNextLevel: number;
}

export const DEFAULT_SMALL_BLIND = 10;
export const DEFAULT_BIG_BLIND = 20;
export const DEFAULT_HANDS_PER_LEVEL = 15;

export const DEFAULT_POKER_BLIND_LEVELS: readonly PokerBlinds[] = [
  { smallBlind: 10, bigBlind: 20 },
  { smallBlind: 15, bigBlind: 30 },
  { smallBlind: 20, bigBlind: 40 },
  { smallBlind: 25, bigBlind: 50 },
  { smallBlind: 40, bigBlind: 80 },
  { smallBlind: 50, bigBlind: 100 },
  { smallBlind: 75, bigBlind: 150 },
  { smallBlind: 100, bigBlind: 200 },
  { smallBlind: 150, bigBlind: 300 },
  { smallBlind: 200, bigBlind: 400 },
];

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive integer`);
  return value;
}

// Continue through the familiar 1, 1.5, 2, 3, 4, 6, 8 tournament cadence.
// Starting after 400 this produces 600, 800, 1,000, 1,500, 2,000, ... rather
// than leaving a long-running tournament frozen at the end of the preset.
function nextRoundedBigBlind(current: number): number {
  const exponent = 10 ** Math.floor(Math.log10(current));
  const candidates = [1, 1.5, 2, 3, 4, 6, 8, 10].map((n) => Math.round(n * exponent));
  return candidates.find((candidate) => candidate > current) ?? exponent * 15;
}

function scaledDefaultLevels(initialSmallBlind: number, initialBigBlind: number): PokerBlinds[] {
  if (initialSmallBlind === DEFAULT_SMALL_BLIND && initialBigBlind === DEFAULT_BIG_BLIND) {
    return DEFAULT_POKER_BLIND_LEVELS.map((level) => ({ ...level }));
  }
  const scale = initialBigBlind / DEFAULT_BIG_BLIND;
  return DEFAULT_POKER_BLIND_LEVELS.map((level, index) => index === 0
    ? { smallBlind: initialSmallBlind, bigBlind: initialBigBlind }
    : {
        smallBlind: Math.max(1, Math.round(level.smallBlind * scale)),
        bigBlind: Math.max(2, Math.round(level.bigBlind * scale)),
      });
}

export function pokerBlindState(completedHands: number, structure: PokerBlindStructure = {}): PokerBlindState {
  if (!Number.isInteger(completedHands) || completedHands < 0) throw new RangeError('completedHands must be a non-negative integer');
  const handsPerLevel = positiveInteger(structure.handsPerLevel ?? DEFAULT_HANDS_PER_LEVEL, 'handsPerLevel');
  const initialSmallBlind = positiveInteger(structure.initialSmallBlind ?? DEFAULT_SMALL_BLIND, 'initialSmallBlind');
  const initialBigBlind = positiveInteger(structure.initialBigBlind ?? DEFAULT_BIG_BLIND, 'initialBigBlind');
  if (initialSmallBlind > initialBigBlind) throw new RangeError('small blind cannot exceed big blind');
  const levels = structure.levels?.map((level) => ({
    smallBlind: positiveInteger(level.smallBlind, 'smallBlind'),
    bigBlind: positiveInteger(level.bigBlind, 'bigBlind'),
  })) ?? scaledDefaultLevels(initialSmallBlind, initialBigBlind);
  if (levels.length === 0) throw new RangeError('blind structure needs at least one level');

  const levelIndex = Math.floor(completedHands / handsPerLevel);
  while (levels.length <= levelIndex) {
    const bigBlind = nextRoundedBigBlind(levels.at(-1)!.bigBlind);
    levels.push({ smallBlind: Math.max(1, Math.round(bigBlind / 2)), bigBlind });
  }
  const blinds = levels[levelIndex];
  return {
    ...blinds,
    level: levelIndex + 1,
    hand: completedHands + 1,
    completedHands,
    handsPerLevel,
    handsUntilNextLevel: handsPerLevel - (completedHands % handsPerLevel),
  };
}

export function pokerTournamentContext(state: PokerBlindState, stack: number): string {
  const bigBlinds = state.bigBlind > 0 ? stack / state.bigBlind : 0;
  const formatted = Number.isInteger(bigBlinds) ? String(bigBlinds) : bigBlinds.toFixed(1);
  return [
    `Tournament hand ${state.hand}, blind level ${state.level}: ${state.smallBlind}/${state.bigBlind}.`,
    `Your stack: ${stack} chips (${formatted} big blinds).`,
    `${state.handsUntilNextLevel} hand${state.handsUntilNextLevel === 1 ? '' : 's'} until the next blind increase.`,
  ].join(' ');
}
