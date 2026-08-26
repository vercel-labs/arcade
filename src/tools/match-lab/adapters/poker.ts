import { normalizerModel } from '../../../arcade/match/models.ts';
import { runPokerSession } from '../../../arcade/match/poker-session.ts';
import { mulberry32 } from '../random.ts';
import type { MatchLabAdapter } from '../types.ts';

export const runPokerMatchLab: MatchLabAdapter = async ({ plan, signal, emit }) => {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const rng = mulberry32(plan.seed);
  const session = await runPokerSession({
    models: plan.models,
    startingStack: plan.startingChips,
    smallBlind: plan.smallBlind,
    bigBlind: plan.bigBlind,
    handsPerLevel: plan.handsPerLevel,
    maxHands: plan.limits.maxHands,
    maxActions: plan.limits.maxActions,
    rng,
    fallbackRng: rng,
    normalizer: normalizerModel(),
    signal,
    onAttempt: (seat, attempt) => emit({ type: 'model_attempt', game: 'poker', seat, model: plan.models[seat], data: attempt }),
    onEvent: (event) => {
      const type = event.type === 'hand_started' ? 'hand_started'
        : event.type === 'hand_finished' ? 'hand_finished'
          : event.type;
      emit({
        type,
        game: 'poker',
        seat: event.seat,
        model: event.model,
        action: event.type === 'action_applied' ? undefined : event.hand,
        data: { hand: event.hand, action: event.action, choice: event.choice, blinds: event.blinds, state: event.state },
      });
    },
  });
  const endedAt = new Date().toISOString();
  return {
    id: plan.id,
    game: 'poker',
    status: session.status,
    models: plan.models,
    seed: plan.seed,
    startedAt,
    endedAt,
    durationMs: Math.max(0, Math.round(performance.now() - started)),
    actionCount: session.actionCount,
    winnerSeats: session.winnerSeats,
    stopReason: session.stopReason,
    canonical: { match: session.matchRecord, hands: session.handRecords },
    finalState: { stacks: session.finalStacks, hands: session.handCount, blindProgression: session.blindProgression },
  };
};
