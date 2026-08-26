import { resolve } from 'node:path';
import { STARTING_STACK } from '../../arcade/match/poker-session.ts';
import { DEFAULT_BIG_BLIND, DEFAULT_HANDS_PER_LEVEL, DEFAULT_SMALL_BLIND } from '../../rules/poker/blinds.ts';
import { DEFAULT_CATAN_MODELS } from './adapters/catan.ts';
import { deriveSeed } from './random.ts';
import type { MatchLabGame, MatchLabLimits, MatchLabPlan } from './types.ts';
import type { CommunicationMode } from '../../ai/communication/types.ts';

const DEFAULT_MODELS: Record<MatchLabGame, string[]> = {
  chess: ['anthropic/claude-haiku-4.5', 'openai/gpt-5.4-nano'],
  catan: DEFAULT_CATAN_MODELS,
  poker: [
    'xai/grok-4.1-fast-non-reasoning',
    'anthropic/claude-haiku-4.5',
    'openai/gpt-5.4-nano',
    'google/gemini-2.5-flash',
  ],
};

export interface MatchLabConfig {
  game: MatchLabGame;
  models: string[];
  games: number;
  concurrency: number;
  seed: number;
  output?: string;
  swapSeats: boolean;
  setupOnly: boolean;
  communicationMode: CommunicationMode;
  startingChips: number;
  smallBlind: number;
  bigBlind: number;
  handsPerLevel: number;
  limits: MatchLabLimits;
}

function value(args: readonly string[], name: string): string | undefined {
  const exact = args.indexOf(`--${name}`);
  if (exact >= 0 && args[exact + 1] && !args[exact + 1].startsWith('--')) return args[exact + 1];
  return args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function positiveInt(args: readonly string[], name: string, fallback: number): number {
  const raw = value(args, name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new RangeError(`--${name} must be a positive integer`);
  return parsed;
}

export function parseMatchLabConfig(args: readonly string[]): MatchLabConfig {
  const game = value(args, 'game') as MatchLabGame | undefined;
  if (!game || !['chess', 'catan', 'poker'].includes(game)) throw new Error('--game must be chess, catan, or poker');
  const models = value(args, 'models')?.split(',').map((model) => model.trim()).filter(Boolean) ?? DEFAULT_MODELS[game].slice();
  const expected = game === 'chess' ? 'exactly 2' : game === 'catan' ? '2 through 4' : '2 through 6';
  const valid = game === 'chess' ? models.length === 2 : game === 'catan' ? models.length >= 2 && models.length <= 4 : models.length >= 2 && models.length <= 6;
  if (!valid) throw new RangeError(`${game} requires ${expected} models; received ${models.length}`);
  const output = value(args, 'output');
  const communicationMode = (value(args, 'communication') ?? 'autoreply') as CommunicationMode;
  if (!['autoreply', 'ambient'].includes(communicationMode)) throw new Error('--communication must be autoreply or ambient');
  return {
    game,
    models,
    games: positiveInt(args, 'games', 1),
    concurrency: positiveInt(args, 'concurrency', 1),
    seed: positiveInt(args, 'seed', 0xa11ce),
    ...(output ? { output: resolve(output) } : {}),
    swapSeats: args.includes('--swap-seats') || args.includes('--rotate-seats'),
    setupOnly: args.includes('--setup-only'),
    communicationMode,
    startingChips: positiveInt(args, 'starting-chips', STARTING_STACK),
    smallBlind: positiveInt(args, 'small-blind', DEFAULT_SMALL_BLIND),
    bigBlind: positiveInt(args, 'big-blind', DEFAULT_BIG_BLIND),
    handsPerLevel: positiveInt(args, 'hands-per-level', DEFAULT_HANDS_PER_LEVEL),
    limits: {
      timeoutMs: positiveInt(args, 'timeout', 600) * 1_000,
      maxActions: positiveInt(args, 'max-actions', game === 'catan' ? 500 : 2_000),
      maxPlies: positiveInt(args, 'max-plies', 300),
      maxHands: positiveInt(args, 'max-hands', 100),
    },
  };
}

function rotate<T>(values: readonly T[], offset: number): T[] {
  const by = ((offset % values.length) + values.length) % values.length;
  return [...values.slice(by), ...values.slice(0, by)];
}

export function buildMatchPlans(config: MatchLabConfig): MatchLabPlan[] {
  return Array.from({ length: config.games }, (_, index) => ({
    id: String(index + 1).padStart(4, '0'),
    index,
    game: config.game,
    models: config.swapSeats ? rotate(config.models, index) : config.models.slice(),
    seed: deriveSeed(config.seed, index),
    limits: { ...config.limits },
    startingChips: config.startingChips,
    smallBlind: config.smallBlind,
    bigBlind: config.bigBlind,
    handsPerLevel: config.handsPerLevel,
    setupOnly: config.setupOnly,
    communicationMode: config.communicationMode,
  }));
}
