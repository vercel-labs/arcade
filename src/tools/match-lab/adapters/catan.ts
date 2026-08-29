import type { Player } from '../../../harness/player.ts';
import { directedReplyOpportunities, primaryMoment, reactionOpportunities } from '../../../harness/communication/moments.ts';
import type { PublicConversationMessage } from '../../../harness/communication/types.ts';
import { CATAN_DEFAULT_AI_SEATS } from '../../../arcade/match/catan-defaults.ts';
import {
  CatanMatchActionLimitError,
  createCatanModelPlayer,
  createCatanSetupModelPlayer,
  runCatanInitialPlacement,
  runHeadlessCatanMatch,
} from '../../../harness/games/catan/catan-setup.ts';
import { normalizerModel } from '../../../arcade/match/models.ts';
import { CatanCommunicationCoordinator } from '../../../harness/games/catan/catan-communication.ts';
import { detectCatanMoments } from '../../../harness/games/catan/catan-moments.ts';
import { NUM_EDGES, NUM_NODES } from '../../../rules/catan/board-topology.ts';
import { CatanState } from '../../../rules/catan/catan.ts';
import { DEV_CARD_TYPES, PLAYER_COLORS, RESOURCES, resourceIndex, type CatanAction, type Resource } from '../../../rules/catan/types.ts';
import { mulberry32 } from '../random.ts';
import type { MatchLabAdapter } from '../types.ts';

export const DEFAULT_CATAN_MODELS = CATAN_DEFAULT_AI_SEATS.map((seat) => seat.model);

function resourceCounts(deck: readonly number[]): Record<Resource, number> {
  return Object.fromEntries(RESOURCES.map((resource) => [resource, deck[resourceIndex(resource)] ?? 0])) as Record<Resource, number>;
}

function checkpoint(state: CatanState): unknown {
  const buildings = [];
  const roads = [];
  for (let node = 0; node < NUM_NODES; node++) {
    const building = state.buildingAt(node);
    if (building) buildings.push({ node, ...building });
  }
  for (let edge = 0; edge < NUM_EDGES; edge++) {
    const player = state.roadAt(edge);
    if (player !== undefined) roads.push({ edge, player });
  }
  return {
    prompt: state.currentPrompt(),
    dice: state.dice(),
    bank: resourceCounts(state.bankDeck()),
    developmentDeck: state.developmentDeckSize(),
    hands: Array.from({ length: state.n }, (_, seat) => resourceCounts(state.handOf(seat))),
    players: Array.from({ length: state.n }, (_, seat) => ({
      seat,
      color: PLAYER_COLORS[seat],
      publicVictoryPoints: state.victoryPoints(seat, false),
      victoryPoints: state.victoryPoints(seat, true),
      playedKnights: state.playedKnightCount(seat),
      roadLength: state.roadLength(seat),
      developmentCards: Object.fromEntries(DEV_CARD_TYPES.map((type) => [type, state.developmentCardCount(seat, type)])),
    })),
    buildings,
    roads,
    trade: state.activeTrade(),
  };
}

export const runCatanMatchLab: MatchLabAdapter = async ({ plan, signal, emit }) => {
  if (plan.models.length < 2 || plan.models.length > 4) throw new RangeError('Catan needs two through four models');
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const rng = mulberry32(plan.seed);
  const normalizer = normalizerModel();
  const state = new CatanState({
    numPlayers: plan.models.length,
    seatNames: plan.models,
    domesticTrade: true,
    domesticTradeOfferLimit: 3,
    rng,
  });
  const communication = new CatanCommunicationCoordinator(plan.communicationMode, plan.models);
  const makePlayer = plan.setupOnly ? createCatanSetupModelPlayer : createCatanModelPlayer;
  const players: Player<CatanAction>[] = plan.models.map((model, seat) => makePlayer({
    model,
    name: model,
    normalizer,
    fallbackRng: rng,
    communication: communication.modelConfig(),
    contextProvider: (player) => communication.contextFor(player),
    onAttempt: (attempt) => emit({ type: 'model_attempt', game: 'catan', seat, model, data: attempt }),
  }));
  let stopReason = plan.setupOnly ? 'setup complete' : 'game complete';
  let pendingAction = '';
  let beforeAction = state.clone();
  let actorMessage: PublicConversationMessage | undefined;
  const hooks = {
    signal,
    onThinking: (_player: Player<CatanAction>, seat: number) => emit({ type: 'decision_started' as const, game: 'catan' as const, seat, model: plan.models[seat], action: state.actionRecords().length + 1, data: { prompt: state.currentPrompt() } }),
    onCommentary: (text: string, _player: Player<CatanAction>, seat: number) => emit({ type: 'commentary' as const, game: 'catan' as const, seat, model: plan.models[seat], action: state.actionRecords().length + 1, data: { text } }),
    onActionChosen: ({ playerIndex, choice }: { playerIndex: number; choice: Awaited<ReturnType<Player<CatanAction>['chooseAction']>> }) => {
      beforeAction = state.clone();
      actorMessage = undefined;
      pendingAction = state.actionToString(choice.action);
      const actionNumber = state.actionRecords().length + 1;
      const decision = communication.decide(playerIndex, choice.action, choice.communication, actionNumber);
      emit({ type: 'communication_decision', game: 'catan', seat: playerIndex, model: plan.models[playerIndex], action: actionNumber, data: decision });
      if (decision.communication.mode === 'speak') {
        actorMessage = communication.latestMessage();
        emit({ type: 'commentary', game: 'catan', seat: playerIndex, model: plan.models[playerIndex], action: actionNumber, data: { text: decision.communication.text, intent: decision.communication.intent } });
      }
      emit({ type: 'action_chosen', game: 'catan', seat: playerIndex, model: plan.models[playerIndex], action: actionNumber, data: { move: pendingAction, communication: choice.communication, diagnostics: choice.diagnostics } });
    },
    onActionApplied: async ({ playerIndex, choice }: { playerIndex: number; choice: Awaited<ReturnType<Player<CatanAction>['chooseAction']>> }) => {
      const actionNumber = state.actionRecords().length;
      emit({ type: 'action_applied', game: 'catan', seat: playerIndex, model: plan.models[playerIndex], action: actionNumber, data: { move: pendingAction, outcome: state.actionRecords().at(-1)?.outcome, checkpoint: checkpoint(state) } });
      if (plan.communicationMode !== 'ambient') return;
      if (actorMessage?.addressedSeats.length) {
        for (const opportunity of directedReplyOpportunities(actorMessage, 'catan', plan.models.length)) {
          emit({ type: 'communication_opportunity', game: 'catan', seat: opportunity.seat, model: plan.models[opportunity.seat], action: actionNumber, data: opportunity });
          const proposal = await players[opportunity.seat]?.chooseCommunication?.({
            opportunity,
            gameView: state.informationStateString(opportunity.seat),
            conversation: communication.contextFor(opportunity.seat),
            signal,
          });
          const decision = communication.decideDirectedReply(opportunity, proposal, actionNumber);
          emit({ type: 'communication_decision', game: 'catan', seat: opportunity.seat, model: plan.models[opportunity.seat], action: actionNumber, data: { ...decision, opportunity } });
          if (decision.communication.mode === 'speak') {
            emit({
              type: 'commentary', game: 'catan', seat: opportunity.seat, model: plan.models[opportunity.seat], action: actionNumber,
              data: { text: decision.communication.text, intent: decision.communication.intent, reaction: true, directedReply: true, momentId: opportunity.moment.id },
            });
          }
        }
      }
      const moments = detectCatanMoments(beforeAction, choice.action, state, playerIndex, actionNumber, plan.models);
      for (const moment of moments) {
        emit({ type: 'moment_detected', game: 'catan', seat: playerIndex, model: plan.models[playerIndex], action: actionNumber, data: moment });
      }
      const moment = primaryMoment(moments);
      if (!moment) return;
      for (const opportunity of reactionOpportunities(moment, 1)) {
        emit({ type: 'communication_opportunity', game: 'catan', seat: opportunity.seat, model: plan.models[opportunity.seat], action: actionNumber, data: opportunity });
        const proposal = await players[opportunity.seat]?.chooseCommunication?.({ opportunity, gameView: state.informationStateString(opportunity.seat), conversation: communication.contextFor(opportunity.seat), signal });
        const decision = communication.decideOpportunity(opportunity, proposal, actionNumber);
        emit({ type: 'communication_decision', game: 'catan', seat: opportunity.seat, model: plan.models[opportunity.seat], action: actionNumber, data: { ...decision, opportunity } });
        if (decision.communication.mode === 'speak') emit({ type: 'commentary', game: 'catan', seat: opportunity.seat, model: plan.models[opportunity.seat], action: actionNumber, data: { text: decision.communication.text, intent: decision.communication.intent, reaction: true, momentId: moment.id } });
      }
    },
  };
  try {
    if (plan.setupOnly) {
      await runCatanInitialPlacement(
        { state: () => state, playMove: async (action) => state.applyAction(action) },
        players,
        { ...hooks, maxActions: plan.limits.maxActions },
      );
    } else {
      const result = await runHeadlessCatanMatch(state, players, { ...hooks, maxActions: plan.limits.maxActions });
      if (result.stopReason === 'action_limit') stopReason = 'action limit';
      else if (result.stopReason === 'aborted') stopReason = 'timeout';
    }
  } catch (error) {
    if (plan.setupOnly && error instanceof CatanMatchActionLimitError) stopReason = 'action limit';
    else if (signal.aborted) stopReason = 'timeout';
    else throw error;
  }
  if (signal.aborted) stopReason = 'timeout';
  else if (state.isTerminal()) stopReason = 'victory';
  const utilities = state.returns();
  const best = Math.max(...utilities);
  const winnerSeats = state.isTerminal() ? utilities.flatMap((value, seat) => value === best ? [seat] : []) : [];
  const endedAt = new Date().toISOString();
  const finalState = { ...(checkpoint(state) as Record<string, unknown>), communication: communication.summary() };
  return {
    id: plan.id,
    game: 'catan',
    status: state.isTerminal() || (plan.setupOnly && state.initialPlacementComplete()) ? 'completed' : 'bounded',
    models: plan.models,
    seed: plan.seed,
    startedAt,
    endedAt,
    durationMs: Math.max(0, Math.round(performance.now() - started)),
    actionCount: state.actionRecords().length,
    winnerSeats,
    stopReason,
    canonical: {
      game: 'catan',
      rulesVersion: 'catan-1',
      status: state.isTerminal() ? 'completed' : plan.setupOnly && state.initialPlacementComplete() ? 'setup_complete' : 'bounded',
      seed: plan.seed,
      models: plan.models,
      transcript: state.transcript(),
      finalState,
    },
    finalState,
  };
};
