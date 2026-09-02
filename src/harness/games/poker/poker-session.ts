import { runMatch, type MatchScene } from '../../match.ts';
import { TableCommunicationCoordinator } from '../../communication/coordinator.ts';
import { ModelPlayer, type ModelPlayerOpts, type MoveNotation } from '../../model-player.ts';
import type { ActionChoice, Player } from '../../player.ts';
import type { CommunicationDecision, CommunicationMode } from '../../communication/types.ts';
import { HoldemState, type PokerAction } from '../../../rules/poker/holdem.ts';
import {
  DEFAULT_BIG_BLIND,
  DEFAULT_HANDS_PER_LEVEL,
  DEFAULT_SMALL_BLIND,
  pokerBlindState,
  pokerTournamentContext,
  type PokerBlindState,
  type PokerBlindStructure,
} from '../../../rules/poker/blinds.ts';
import type { PokerHandRecord, PokerMatchRecord } from '../../records.ts';
import { PokerSessionRecorder } from '../../recording/game-recorders.ts';
import { disambiguateLabels } from '../../labels.ts';
import { shortModel } from '../../model-label.ts';

export const STARTING_STACK = 1000;
export const SMALL_BLIND = DEFAULT_SMALL_BLIND;
export const BIG_BLIND = DEFAULT_BIG_BLIND;
export const HANDS_PER_BLIND_LEVEL = DEFAULT_HANDS_PER_LEVEL;

export const POKER_NOTATION: MoveNotation = {
  description: 'a poker action — one of "fold", "check", "call", "bet <amount>", "raise <amount>", or "allin" (amounts are TOTAL chips to put in this street)',
  examples: '"call", "raise 120", "fold", "allin"',
};

export const POKER_PERSONA =
  "You are playing live no-limit Texas Hold'em against the other players at the table. " +
  'Everything you say out loud is heard by everyone, so bluff and mislead freely but never ' +
  'honestly reveal the cards you are holding.';

export type PokerTextPlayerOpts = Pick<
  ModelPlayerOpts,
  'model' | 'name' | 'normalizer' | 'normalizerName' | 'fallbackRng' | 'onAttempt' | 'onFailureNotice'
> & {
  contextProvider?: () => string;
  communication?: ModelPlayerOpts['communication'];
};

/** The production text-poker prompt and action parser, shared by the TUI and headless lab. */
export function createPokerTextPlayer(opts: PokerTextPlayerOpts): ModelPlayer<PokerAction> {
  const { communication, ...base } = opts;
  return new ModelPlayer<PokerAction>({
    ...base,
    gameName: "no-limit Texas Hold'em poker",
    moveNotation: POKER_NOTATION,
    persona: POKER_PERSONA,
    ...(communication ? { communication } : {
      speech:
        'a line or two of live table talk in your own voice: banter, needle, read the board, rattle an opponent. Talk to the table, do not just announce your move. Bluff and lie about your hand freely, but never honestly reveal the cards you are holding.',
    }),
    contextProvider: opts.contextProvider ? () => opts.contextProvider?.() ?? '' : undefined,
  });
}

export interface PokerSessionEvent {
  type: 'blind_level_changed' | 'hand_started' | 'decision_started' | 'commentary' | 'communication_decision' | 'action_chosen' | 'action_applied' | 'hand_finished';
  hand: number;
  actionNumber?: number;
  seat?: number;
  model?: string;
  action?: string;
  choice?: ActionChoice<PokerAction>;
  decision?: CommunicationDecision;
  state?: unknown;
  blinds?: PokerBlindState;
}

export interface HeadlessPokerSessionOpts {
  models: string[];
  /** Test/custom seam; omitted in real runs, which create production ModelPlayers. */
  players?: Player<PokerAction>[];
  startingStack?: number;
  smallBlind?: number;
  bigBlind?: number;
  handsPerLevel?: number;
  blindLevels?: PokerBlindStructure['levels'];
  maxHands?: number;
  maxActions?: number;
  rng?: () => number;
  signal?: AbortSignal;
  normalizer?: string;
  fallbackRng?: () => number;
  onAttempt?: (seat: number, info: { phase: 'structured' | 'text' | 'normalize'; raw: string; result: 'legal' | 'illegal' | 'error' }) => void;
  onEvent?: (event: PokerSessionEvent) => void;
  communicationMode?: CommunicationMode;
}

export interface HeadlessPokerSessionResult {
  status: 'completed' | 'bounded';
  stopReason: string;
  actionCount: number;
  handCount: number;
  finalStacks: number[];
  winnerSeats: number[];
  handRecords: PokerHandRecord[];
  matchRecord: PokerMatchRecord;
  blindProgression: PokerBlindState[];
  communication?: Record<string, number>;
}

const POKER_AMBIENT_GUIDE =
  'Public speech should sound like optional live poker table talk, not an action log. Useful speech includes replying to another player, a concise bluff or needle, reacting to a large visible bet, or commenting on public table dynamics. Never honestly reveal hole cards, exact private hand strength, or private calculations. Do not announce every check, call, or fold. Usually choose silence.';

function pokerActionSalience(action: PokerAction): number {
  switch (action.type) {
    case 'allin': return 0.94;
    case 'raise': return 0.68;
    case 'bet': return 0.58;
    case 'call':
    case 'fold': return 0.24;
    case 'check': return 0.08;
  }
}

class HeadlessPokerScene implements MatchScene<PokerAction> {
  constructor(private readonly hand: HoldemState) {}
  state(): HoldemState { return this.hand; }
  async playMove(action: PokerAction): Promise<void> { this.hand.applyAction(action); }
}

function nextAlive(stacks: readonly number[], from: number): number {
  for (let offset = 1; offset <= stacks.length; offset++) {
    const seat = (from + offset) % stacks.length;
    if (stacks[seat] > 0) return seat;
  }
  return from;
}

function standings(labels: readonly string[], stacks: readonly number[]): string {
  let leader = 0;
  for (let seat = 1; seat < stacks.length; seat++) if (stacks[seat] > stacks[leader]) leader = seat;
  return `Chip standings: ${stacks.map((chips, seat) => `${labels[seat]} ${chips}`).join(', ')}. Chip leader: ${labels[leader]}.`;
}

/**
 * UI-independent production poker session loop. It carries stacks/button across hands,
 * drives the same rules + ModelPlayer semantics as PokerMatch, and creates canonical
 * records without publishing them.
 */
export async function runPokerSession(opts: HeadlessPokerSessionOpts): Promise<HeadlessPokerSessionResult> {
  if (opts.models.length < 2 || opts.models.length > 6) throw new RangeError('Poker needs 2–6 models');
  const startingStack = opts.startingStack ?? STARTING_STACK;
  const smallBlind = opts.smallBlind ?? SMALL_BLIND;
  const bigBlind = opts.bigBlind ?? BIG_BLIND;
  const blindStructure: PokerBlindStructure = {
    initialSmallBlind: smallBlind,
    initialBigBlind: bigBlind,
    handsPerLevel: opts.handsPerLevel,
    levels: opts.blindLevels,
  };
  const maxHands = opts.maxHands ?? 100;
  const maxActions = opts.maxActions ?? 2_000;
  const rng = opts.rng ?? Math.random;
  const fallbackRng = opts.fallbackRng ?? rng;
  const labels = disambiguateLabels(opts.models.map((model) => ({ key: model, label: shortModel(model) })));
  const communication = opts.communicationMode === 'ambient'
    ? new TableCommunicationCoordinator('ambient', labels, POKER_AMBIENT_GUIDE)
    : null;
  const stacks = opts.models.map(() => startingStack);
  const recorder = new PokerSessionRecorder(
    'ai_table',
    opts.models.map((model) => ({ kind: 'model' as const, model, runtime: 'text' as const })),
    stacks,
    smallBlind,
    bigBlind,
  );
  if (opts.players && opts.players.length !== opts.models.length) throw new RangeError('Poker needs one player implementation per model seat');
  let currentBlinds = pokerBlindState(0, blindStructure);
  const players: Player<PokerAction>[] = opts.players ?? opts.models.map((model, seat) => createPokerTextPlayer({
      model,
      name: labels[seat],
      normalizer: opts.normalizer,
      fallbackRng,
      ...(communication ? { communication: communication.modelConfig() } : {}),
      contextProvider: () => [
        pokerTournamentContext(currentBlinds, stacks[seat]),
        standings(labels, stacks),
        communication?.contextFor(seat) ?? '',
      ].filter(Boolean).join('\n\n'),
      onAttempt: (info) => opts.onAttempt?.(seat, info),
    }));
  const handRecords: PokerHandRecord[] = [];
  let button = 0;
  let handCount = 0;
  let actionCount = 0;
  let completedHands = 0;
  let lastBlindLevel = 0;
  const blindProgression: PokerBlindState[] = [];
  let stopReason = 'max hands';

  while (stacks.filter((stack) => stack > 0).length > 1 && handCount < maxHands && actionCount < maxActions) {
    if (opts.signal?.aborted) {
      stopReason = 'timeout';
      break;
    }
    if (stacks[button] <= 0) button = nextAlive(stacks, button);
    currentBlinds = pokerBlindState(completedHands, blindStructure);
    handCount++;
    if (currentBlinds.level !== lastBlindLevel) {
      lastBlindLevel = currentBlinds.level;
      blindProgression.push({ ...currentBlinds });
      opts.onEvent?.({ type: 'blind_level_changed', hand: handCount, blinds: { ...currentBlinds }, state: { ...currentBlinds } });
    }
    const state = new HoldemState({
      stacks: stacks.slice(),
      button,
      smallBlind: currentBlinds.smallBlind,
      bigBlind: currentBlinds.bigBlind,
      seatNames: labels,
      rng,
    });
    const scene = new HeadlessPokerScene(state);
    recorder.beginHand(currentBlinds.smallBlind, currentBlinds.bigBlind);
    opts.onEvent?.({ type: 'hand_started', hand: handCount, blinds: { ...currentBlinds }, state: state.canonicalRecord() });
    let pendingAction = '';
    try {
      await runMatch(scene, players, {
        signal: opts.signal,
        shouldStop: () => actionCount >= maxActions,
        onThinking: (_player, seat) => opts.onEvent?.({ type: 'decision_started', hand: handCount, seat, model: opts.models[seat] }),
        onCommentary: (text, _player, seat) => opts.onEvent?.({ type: 'commentary', hand: handCount, seat, model: opts.models[seat], state: text }),
        onActionChosen: ({ player, playerIndex, choice }) => {
          pendingAction = state.actionToString(choice.action);
          recorder.actionChosen(playerIndex, player, choice, false, 'text', opts.models[playerIndex]);
          if (communication) {
            const decision = communication.decide(playerIndex, choice.communication, actionCount + 1, pokerActionSalience(choice.action));
            opts.onEvent?.({ type: 'communication_decision', hand: handCount, actionNumber: actionCount + 1, seat: playerIndex, model: opts.models[playerIndex], action: pendingAction, choice, decision });
            if (decision.communication.mode === 'speak') opts.onEvent?.({ type: 'commentary', hand: handCount, seat: playerIndex, model: opts.models[playerIndex], state: decision.communication.text });
          }
          opts.onEvent?.({ type: 'action_chosen', hand: handCount, actionNumber: actionCount + 1, seat: playerIndex, model: opts.models[playerIndex], action: pendingAction, choice });
        },
        onActionApplied: ({ playerIndex }) => {
          actionCount++;
          recorder.actionApplied();
          opts.onEvent?.({ type: 'action_applied', hand: handCount, actionNumber: actionCount, seat: playerIndex, model: opts.models[playerIndex], action: pendingAction, state: state.canonicalRecord() });
        },
      });
    } catch (error) {
      if (!opts.signal?.aborted) throw error;
    }
    if (!state.isTerminal()) {
      stopReason = opts.signal?.aborted ? 'timeout' : 'action limit';
      break;
    }
    const returns = state.returns();
    for (let seat = 0; seat < stacks.length; seat++) stacks[seat] += returns[seat];
    const handRecord = recorder.finishHand(state.canonicalRecord(), true);
    handRecords.push(handRecord);
    completedHands++;
    opts.onEvent?.({ type: 'hand_finished', hand: handCount, state: handRecord });
    button = nextAlive(stacks, button);
  }

  const completed = stacks.filter((stack) => stack > 0).length === 1;
  if (completed) stopReason = 'one player remaining';
  else if (handCount >= maxHands) stopReason = 'max hands';
  else if (actionCount >= maxActions) stopReason = 'action limit';
  const matchRecord = recorder.finishMatch(stacks, completed, completed ? 'natural' : 'user_stopped');
  if (!matchRecord) throw new Error('Poker session recorder finalized without a match record');
  return {
    status: completed ? 'completed' : 'bounded',
    stopReason,
    actionCount,
    handCount,
    finalStacks: stacks.slice(),
    winnerSeats: completed ? stacks.flatMap((stack, seat) => stack > 0 ? [seat] : []) : [],
    handRecords,
    matchRecord,
    blindProgression,
    ...(communication ? { communication: communication.summary() } : {}),
  };
}
